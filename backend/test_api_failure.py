from unittest.mock import patch

from fastapi.testclient import TestClient
from main import app
from services.dpcc_service import DPCCDataError


def simulate_failure(station_key):
    raise DPCCDataError(f"Simulated failure for {station_key}")


with TestClient(app) as client:

    with patch(
        "services.dpcc_service.fetch_pm25_observations",
        side_effect=simulate_failure,
    ):

        response = client.get(
            "/api/delhi/pm25-prediction",
            params={
                "latitude": 28.6315,
                "longitude": 77.2167,
            },
        )

    print("HTTP Status:", response.status_code)
    print("Response:", response.json())

    if response.status_code == 502:
        print("TEST PASSED: API handles complete DPCC failure.")
    else:
        print("TEST FAILED")
