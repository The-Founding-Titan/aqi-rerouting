from unittest.mock import patch

from services.dpcc_service import DPCCDataError
from delhi_ml.delhi_service import DelhiPredictionService


def simulate_failure(station_key):
    raise DPCCDataError(f"Simulated failure for {station_key}")


service = DelhiPredictionService()

with patch(
    "services.dpcc_service.fetch_pm25_observations",
    side_effect=simulate_failure,
):
    try:
        service.predict(28.6315, 77.2167)

    except DPCCDataError as error:
        print("EXPECTED FAILURE:", error)

    else:
        print("TEST FAILED: Prediction was generated unexpectedly")
