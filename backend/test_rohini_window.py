import requests

from backend.services.dpcc_service import (
    DPCC_URL,
    HEADERS,
    STATIONS,
    extract_pm25_data,
)

station = STATIONS["rohini"]
station_id = station["id"]

start_time = "2026-10-31 22:00"
end_time = "2026-11-01 10:00"

station_url = f"{DPCC_URL}?stName={station_id}"

headers = {
    **HEADERS,
    "Referer": station_url,
}

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

        session.get(
            DPCC_URL,
            params={"stName": station_id},
            timeout=30,
        ).raise_for_status()

        response = session.post(
            DPCC_URL,
            params={"stName": station_id},
            data=form_data,
            timeout=30,
        )

        response.raise_for_status()

        with open(
            "backend/rohini_window_test.html",
            "w",
            encoding="utf-8",
        ) as file:
            file.write(response.text)

        timestamps, values = extract_pm25_data(response.text)

        print("Station:", station["name"])
        print("Requested:", start_time, "to", end_time)
        print("Retrieved timestamps:", len(timestamps))
        print("Retrieved values:", len(values))

        print("\nOBSERVATIONS:")

        for timestamp, value in zip(timestamps, values):
            print(timestamp, "|", value)

except Exception as error:
    print("ERROR:", error)
