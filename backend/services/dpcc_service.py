import re
import math
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo
import time
import copy
import threading

import requests

# ==========================================
# 1. DPCC CONFIGURATION
# ==========================================

DPCC_URL = "https://www.dpccairdata.com/" "dpccairdata/display/AallAdvanceSearchMet.php"

INDIA_TZ = ZoneInfo("Asia/Kolkata")

STATIONS = {
    "nsut": {
        "name": "NSUT West Campus",
        "id": "TnN1dA==",
        "latitude": 28.60909,
        "longitude": 77.0325413,
        "enabled": True,
    },
    "cwg": {
        "name": "CWG Sports Complex, Akshardham",
        "id": "Q3dnU3BvcnRz",
        "latitude": 28.6158,
        "longitude": 77.2720,
        "enabled": True,
    },
    "jnu": {
        "name": "JNU",
        "id": "Sm51",
        "latitude": 28.5400,
        "longitude": 77.1660,
        "enabled": True,
    },
    "ignou": {
        "name": "IGNOU",
        "id": "SWdub3U=",
        "latitude": 28.5445,
        "longitude": 77.2705,
        "enabled": True,
    },
    "rohini": {
        "name": "Rohini Sector 16",
        "id": "Um9oaW5pU2VjdG9yMTY=",
        "latitude": 28.732528,
        "longitude": 77.11992,
        "enabled": False,
    },
    "okhla": {
        "name": "Okhla Phase 2",
        "id": "T2tobGFQaGFzZTI=",
        "latitude": 28.530785,
        "longitude": 77.271255,
        "enabled": False,
    },
    "dwarka": {
        "name": "Dwarka Sector 8",
        "id": "RHdhcmthU2VjdHJvOA==",
        "latitude": 28.5810,
        "longitude": 77.0580,
        "enabled": False,
    },
}


HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/156.0.0.0 Safari/537.36"
    ),
    "Accept": ("text/html,application/xhtml+xml,application/xml;" "q=0.9,*/*;q=0.8"),
    "Accept-Language": "en-US,en;q=0.9",
    "Origin": "https://www.dpccairdata.com",
}


# ==========================================
# 2. CUSTOM ERROR
# ==========================================


class DPCCDataError(Exception):
    """Raised when valid DPCC observations cannot be retrieved."""


# ==========================================
# 3. GENERATE RECENT HOURLY WINDOW
# ==========================================


def get_recent_window():

    now = datetime.now(INDIA_TZ)

    end_time = now.replace(
        minute=0,
        second=0,
        microsecond=0,
    ) - timedelta(hours=1)

    # DPCC excludes the starting boundary.
    # Request 26 hours to receive 25 observations.
    start_time = end_time - timedelta(hours=25)

    return (
        start_time.strftime("%Y-%m-%d %H:%M"),
        end_time.strftime("%Y-%m-%d %H:%M"),
    )


# ==========================================
# 4. EXTRACT CHART DATA
# ==========================================


def extract_pm25_data(html):

    # Remove JavaScript block comments first.
    clean_html = re.sub(
        r"/\*.*?\*/",
        "",
        html,
        flags=re.DOTALL,
    )

    # Extract timestamps.
    categories_match = re.search(
        r"categories\s*:\s*\[(.*?)\]",
        clean_html,
        re.DOTALL,
    )

    if not categories_match:
        raise DPCCDataError("DPCC timestamps were not found.")

    timestamps = re.findall(
        r"""['"]([^'"]+)['"]""",
        categories_match.group(1),
    )

    # Extract chart series.
    series_match = re.search(
        r"series\s*:\s*\[(.*?)\]\s*\}\s*\);",
        clean_html,
        re.DOTALL,
    )

    if not series_match:
        raise DPCCDataError("DPCC chart series was not found.")

    series_block = series_match.group(1)

    # Extract the PM2.5 series name.
    name_match = re.search(
        r"""name\s*:\s*['"]([^'"]+)['"]""",
        series_block,
    )

    if not name_match:
        raise DPCCDataError("DPCC series name was not found.")

    series_name = name_match.group(1)

    if "2.5" not in series_name:
        raise DPCCDataError(f"Unexpected pollutant series: {series_name}")

    # Extract PM2.5 values.
    values_match = re.search(
        r"data\s*:\s*\[(.*?)\]",
        series_block,
        re.DOTALL,
    )

    if not values_match:
        raise DPCCDataError("PM2.5 values were not found.")

    raw_values = re.findall(
        r"-?\d+(?:\.\d+)?",
        values_match.group(1),
    )

    values = [float(value) for value in raw_values]

    if len(timestamps) != len(values):
        raise DPCCDataError("Timestamp/value count mismatch.")

    return timestamps, values


# ==========================================
# 5. VALIDATE HOURLY OBSERVATIONS
# ==========================================


def validate_observations(timestamps, values):

    if len(timestamps) != 25 or len(values) != 25:
        raise DPCCDataError(f"Expected 25 observations, received {len(values)}.")

    observations = []

    for timestamp, value in zip(timestamps, values):

        try:
            parsed_time = datetime.fromisoformat(timestamp)
        except ValueError:
            raise DPCCDataError(f"Invalid DPCC timestamp: {timestamp}")

        if not math.isfinite(value) or value < 0:
            raise DPCCDataError(f"Invalid PM2.5 reading at {timestamp}: {value}")

        observations.append(
            {
                "timestamp": parsed_time.isoformat(),
                "pm25": value,
            }
        )

    observations.sort(key=lambda item: item["timestamp"])

    parsed_times = [datetime.fromisoformat(item["timestamp"]) for item in observations]

    for i in range(1, len(parsed_times)):

        difference = parsed_times[i] - parsed_times[i - 1]

        if difference != timedelta(hours=1):
            raise DPCCDataError(
                "DPCC observations are not consecutive hourly readings."
            )

    # Reject data that is too old.
    now = datetime.now(INDIA_TZ)
    latest_time = parsed_times[-1]

    if latest_time.tzinfo is None:
        latest_time = latest_time.replace(tzinfo=INDIA_TZ)

    if now - latest_time > timedelta(hours=3):
        raise DPCCDataError("Latest DPCC observation is more than 3 hours old.")

    return observations


# ==========================================
# 6. FETCH DPCC PM2.5 DATA
# ==========================================


def fetch_pm25_observations(station_key):
    station_key = station_key.lower()

    if station_key not in STATIONS:
        raise DPCCDataError(f"Unsupported DPCC station: {station_key}")

    station = STATIONS[station_key]
    station_id = station["id"]

    station_url = f"{DPCC_URL}?stName={station_id}"

    headers = {
        **HEADERS,
        "Referer": station_url,
    }

    start_time, end_time = get_recent_window()

    form_data = {
        "parameters": "PM25",
        "fDate": start_time,
        "eDate": end_time,
        "duration": "1",
        "graphType": "Line",
        "submit": "Search",
    }

    try:
        with requests.Session() as session:
            session.headers.update(headers)

            # Establish session.
            get_response = session.get(
                DPCC_URL,
                params={"stName": station_id},
                timeout=30,
            )

            get_response.raise_for_status()

            # Request PM2.5 chart data.
            response = session.post(
                DPCC_URL,
                params={"stName": station_id},
                data=form_data,
                timeout=30,
            )

            response.raise_for_status()

            # Extract PM2.5 timestamps and values.
            timestamps, values = extract_pm25_data(response.text)

            # Validate all 25 consecutive hourly observations.
            observations = validate_observations(
                timestamps,
                values,
            )

            return {
                "station": station["name"],
                "station_key": station_key,
                "source": "DPCC",
                "pollutant": "PM2.5",
                "unit": "µg/m³",
                "observations": observations,
                "observation_count": len(observations),
            }

    except requests.RequestException as error:
        raise DPCCDataError(f"Could not retrieve data from DPCC: {error}") from error


def fetch_all_valid_stations():
    valid_stations = []
    failed_stations = []

    for station_key, station in STATIONS.items():

        if not station["enabled"]:
            continue

        try:
            data = fetch_pm25_observations(station_key)

            valid_stations.append(
                {
                    **data,
                    "latitude": station["latitude"],
                    "longitude": station["longitude"],
                }
            )

        except DPCCDataError as error:
            failed_stations.append(
                {
                    "station": station["name"],
                    "error": str(error),
                }
            )

    return {
        "valid_stations": valid_stations,
        "failed_stations": failed_stations,
        "valid_count": len(valid_stations),
    }


# Cache validated DPCC station observations for 5 minutes.
DPCC_CACHE_TTL = 300

_dpcc_cache = None
_dpcc_cache_time = 0
_dpcc_cache_lock = threading.Lock()


def get_cached_valid_stations():
    global _dpcc_cache, _dpcc_cache_time

    with _dpcc_cache_lock:
        now = time.monotonic()

        if _dpcc_cache is not None and now - _dpcc_cache_time < DPCC_CACHE_TTL:
            print("DPCC CACHE HIT")
            return copy.deepcopy(_dpcc_cache)

        result = fetch_all_valid_stations()

        if not result["valid_stations"]:
            raise DPCCDataError("No Delhi station has valid recent data.")

        _dpcc_cache = result
        _dpcc_cache_time = now

        return copy.deepcopy(_dpcc_cache)


def calculate_distance(lat1, lon1, lat2, lon2):
    """Calculate distance between two coordinates in kilometres."""

    earth_radius = 6371

    lat1, lon1, lat2, lon2 = map(
        math.radians,
        [lat1, lon1, lat2, lon2],
    )

    dlat = lat2 - lat1
    dlon = lon2 - lon1

    a = (
        math.sin(dlat / 2) ** 2
        + math.cos(lat1) * math.cos(lat2) * math.sin(dlon / 2) ** 2
    )

    return 2 * earth_radius * math.asin(math.sqrt(a))


def select_nearest_valid_station(latitude, longitude):
    """Return the nearest station with valid recent observations."""

    result = get_cached_valid_stations()
    valid_stations = result["valid_stations"]

    if not valid_stations:
        raise DPCCDataError("No Delhi station has valid recent data.")

    for station in valid_stations:
        station["distance_km"] = calculate_distance(
            latitude,
            longitude,
            station["latitude"],
            station["longitude"],
        )

    valid_stations.sort(key=lambda station: station["distance_km"])

    return {
        "selected_station": valid_stations[0],
        "available_stations": valid_stations,
        "failed_stations": result["failed_stations"],
    }
