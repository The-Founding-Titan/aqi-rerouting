import json
from datetime import datetime, timedelta
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
import sklearn

# --------------------------------------------------
# CONFIGURATION
# --------------------------------------------------

BASE_DIR = Path(__file__).resolve().parent.parent

MODEL_PATH = BASE_DIR / "ml" / "models" / "delhi_cross_station_pm25_rf_leaf30.joblib"

METADATA_PATH = (
    BASE_DIR / "ml" / "models" / "delhi_cross_station_pm25_rf_leaf30_metadata.json"
)

EXPECTED_FEATURES = [
    "pm25",
    "lag_1",
    "lag_2",
    "lag_3",
    "lag_24",
    "hour",
    "month",
    "day_of_week",
]


class DelhiPM25Predictor:
    """
    Loads the Delhi Random Forest model once and predicts
    next-hour PM2.5 concentration from 25 hourly observations.
    """

    def __init__(self):
        self.model = None
        self.metadata = None
        self.feature_names = EXPECTED_FEATURES.copy()

    def load(self):
        """Load and validate model and metadata."""

        if not MODEL_PATH.exists():
            raise FileNotFoundError(f"Delhi model not found: {MODEL_PATH}")

        if not METADATA_PATH.exists():
            raise FileNotFoundError(f"Model metadata not found: {METADATA_PATH}")

        with open(METADATA_PATH, "r", encoding="utf-8") as file:
            metadata = json.load(file)

        if metadata.get("features") != EXPECTED_FEATURES:
            raise ValueError("Model feature order mismatch.")

        if metadata.get("sklearn_version") != sklearn.__version__:
            raise RuntimeError("Scikit-learn version does not match model metadata.")

        model = joblib.load(MODEL_PATH)

        if model.n_features_in_ != len(EXPECTED_FEATURES):
            raise ValueError("Incorrect model input feature count.")

        if list(model.feature_names_in_) != EXPECTED_FEATURES:
            raise ValueError("Loaded model feature names do not match.")

        if len(model.estimators_) != 100:
            raise ValueError("Unexpected number of decision trees.")

        self.model = model
        self.metadata = metadata

        return True

    def predict(self, observations):
        """
        observations:
            List of 25 dictionaries containing timestamp and pm25.

        Returns next-hour PM2.5 prediction.
        """

        if self.model is None:
            raise RuntimeError("Model has not been loaded.")

        if len(observations) != 25:
            raise ValueError("Exactly 25 hourly observations are required.")

        parsed = []

        for item in observations:
            if "timestamp" not in item or "pm25" not in item:
                raise ValueError("Every observation needs timestamp and pm25.")

            timestamp = datetime.fromisoformat(item["timestamp"])
            value = float(item["pm25"])

            if not np.isfinite(value) or value < 0:
                raise ValueError("Invalid PM2.5 measurement.")

            parsed.append((timestamp, value))

        # Sort chronologically.
        parsed.sort(key=lambda item: item[0])

        timestamps = [item[0] for item in parsed]
        values = [item[1] for item in parsed]

        # Reject duplicate timestamps.
        if len(set(timestamps)) != 25:
            raise ValueError("Duplicate observation timestamps found.")

        # Reject mixed timezone-aware and timezone-naive timestamps.
        timezone_status = [ts.utcoffset() is not None for ts in timestamps]

        if len(set(timezone_status)) != 1:
            raise ValueError("All timestamps must use consistent timezone information.")

        # Validate hourly continuity.
        for previous, current in zip(timestamps, timestamps[1:]):
            if current - previous != timedelta(hours=1):
                raise ValueError("Observations must be consecutive hourly readings.")

        current_time = timestamps[-1]

        # Construct features in the exact training order.
        features = [
            values[-1],  # pm25
            values[-2],  # lag_1
            values[-3],  # lag_2
            values[-4],  # lag_3
            values[-25],  # lag_24
            current_time.hour,
            current_time.month,
            current_time.weekday(),
        ]

        # Use named columns because the model was trained with feature names.
        input_data = pd.DataFrame([features], columns=self.feature_names)

        prediction = float(self.model.predict(input_data)[0])

        if not np.isfinite(prediction):
            raise ValueError("Model generated an invalid prediction.")

        return {
            "prediction": max(0.0, prediction),
            "unit": "µg/m³",
            "pollutant": "PM2.5",
            "prediction_for": (current_time + timedelta(hours=1)).isoformat(sep=" "),
            "input_timestamp": current_time.isoformat(sep=" "),
            "model": self.metadata["model_name"],
            "features": dict(zip(EXPECTED_FEATURES, features)),
        }
