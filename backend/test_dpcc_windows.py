from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

import requests

from services.dpcc_service import (
    DPCC_URL,
    STATIONS,
    HEADERS,
    extract_pm25_data,
)

TZ = ZoneInfo("Asia/Kolkata")

STATION_KEY = "nsut"
END_OFFSETS = [1]


def check_window(session, station_id, end_time):

    start_time = end_time - timedelta(hours=25)

    form_data = {
        "parameters": "PM25",
        "fDate": start_time.strftime("%Y-%m-%d %H:%M"),
        "eDate": end_time.strftime("%Y-%m-%d %H:%M"),
        "duration": "1",
        "graphType": "Line",
        "submit": "Search",
    }

    response = session.post(
        DPCC_URL,
        params={"stName": station_id},
        data=form_data,
        timeout=30,
    )
    response.raise_for_status()

    timestamps, values = extract_pm25_data(response.text)

    print("\nRequested:", form_data["fDate"], "to", form_data["eDate"])
    print("Returned first:", timestamps[0] if timestamps else None)
    print("Returned last:", timestamps[-1] if timestamps else None)
    print("Returned count:", len(timestamps))

    returned = {datetime.fromisoformat(t).replace(tzinfo=None) for t in timestamps}

    expected = [
        (start_time + timedelta(hours=1)).replace(tzinfo=None) + timedelta(hours=i)
        for i in range(25)
    ]

    print("\nMissing hours:")

    missing = [hour for hour in expected if hour not in returned]

    if missing:
        for hour in missing:
            print(" ", hour)
    else:
        print(" None")

    print("\nReturned values:", values)


def main():

    station = STATIONS[STATION_KEY]
    station_id = station["id"]

    station_url = f"{DPCC_URL}?stName={station_id}"

    headers = {
        **HEADERS,
        "Referer": station_url,
    }

    now = datetime.now(TZ)

    latest_completed_hour = now.replace(
        minute=0,
        second=0,
        microsecond=0,
    ) - timedelta(hours=1)

    with requests.Session() as session:

        session.headers.update(headers)

        response = session.get(
            DPCC_URL,
            params={"stName": station_id},
            timeout=30,
        )
        response.raise_for_status()

        print("Station:", station["name"])
        print("Current time:", now)

        for offset in END_OFFSETS:

            end_time = latest_completed_hour - timedelta(hours=offset - 1)

            try:
                check_window(session, station_id, end_time)

            except Exception as error:
                print("ERROR:", error)


if __name__ == "__main__":
    main()
