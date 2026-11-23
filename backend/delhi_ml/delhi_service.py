from services.dpcc_service import (
    select_nearest_valid_station,
    DPCCDataError,
)

from delhi_ml.predictor import DelhiPM25Predictor


class DelhiPredictionService:

    def __init__(self):
        self.predictor = DelhiPM25Predictor()
        self.predictor.load()

    def predict(self, latitude, longitude):

        # 1. Find the nearest station with valid data
        result = select_nearest_valid_station(
            latitude,
            longitude,
        )

        station = result["selected_station"]

        # 2. Get its 25 hourly observations
        observations = station["observations"]

        # 3. Generate next-hour PM2.5 prediction
        prediction = self.predictor.predict(observations)

        # 4. Return prediction and station information
        return {
            "location": {
                "latitude": latitude,
                "longitude": longitude,
            },
            "prediction": prediction,
            "station": {
                "name": station["station"],
                "key": station["station_key"],
                "latitude": station["latitude"],
                "longitude": station["longitude"],
                "distance_km": round(station["distance_km"], 2),
                "observation_count": station["observation_count"],
            },
            "available_station_count": len(result["available_stations"]),
            "failed_stations": result["failed_stations"],
        }
