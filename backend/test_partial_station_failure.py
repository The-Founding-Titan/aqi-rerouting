from unittest.mock import patch
from datetime import datetime, timedelta

from services.dpcc_service import DPCCDataError, STATIONS
from delhi_ml.delhi_service import DelhiPredictionService

# Select one enabled station to simulate as healthy
healthy_station = next(key for key, station in STATIONS.items() if station["enabled"])


def simulate_station_response(station_key):

    if station_key == healthy_station:

        # Generate 25 valid consecutive hourly observations
        now = datetime.now().replace(minute=0, second=0, microsecond=0)

        observations = [
            {"timestamp": (now - timedelta(hours=24 - hour)).isoformat(), "pm25": 80.0}
            for hour in range(25)
        ]

        return {
            "station": STATIONS[station_key]["name"],
            "station_key": station_key,
            "source": "DPCC",
            "pollutant": "PM2.5",
            "unit": "µg/m³",
            "observations": observations,
            "observation_count": len(observations),
            "latitude": STATIONS[station_key]["latitude"],
            "longitude": STATIONS[station_key]["longitude"],
        }

    # Simulate failure for every other enabled station
    raise DPCCDataError(f"Simulated failure for {station_key}")


# Load the ML model
service = DelhiPredictionService()


# Replace live DPCC calls with simulated responses
with patch(
    "services.dpcc_service.fetch_pm25_observations",
    side_effect=simulate_station_response,
):

    result = service.predict(28.6315, 77.2167)

    print("\n========== PARTIAL FAILURE TEST ==========")
    print("Healthy station:", healthy_station)
    print("Selected station:", result["station"]["name"])
    print("Prediction:", result["prediction"])
    print("Available stations:", result["available_station_count"])
    print("Failed stations:", len(result["failed_stations"]))
    print("==========================================")
