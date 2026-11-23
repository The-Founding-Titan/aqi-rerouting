import requests

from datetime import datetime, timedelta

from backend.services.dpcc_service import (
    DPCC_URL,
    HEADERS,
    STATIONS,
    get_recent_window,
    extract_pm25_data,
)

stations = ["rohini", "okhla", "nsut", "dwarka"]

start_time, end_time = get_recent_window()

start = datetime.strptime(start_time, "%Y-%m-%d %H:%M")
end = datetime.strptime(end_time, "%Y-%m-%d %H:%M")

expected = [
    (start + timedelta(hours=i)).strftime("%Y-%m-%d %H:%M") for i in range(1, 26)
]

for station_key in stations:

    station = STATIONS[station_key]
    station_id = station["id"]

    station_url = f"{DPCC_URL}?stName={station_id}"

    headers = {
        **HEADERS,
        "Referer": station_url,
    }

    print("\n" + "=" * 60)
    print("STATION:", station["name"])
    print("=" * 60)

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
                data={
                    "parameters": "PM25",
                    "fDate": start_time,
                    "eDate": end_time,
                    "duration": "1",
                    "graphType": "Line",
                    "submit": "Search",
                },
                timeout=30,
            )

            response.raise_for_status()

            # Save the original HTML for inspection.
            if station_key == "rohini":
                with open("backend/rohini_raw.html", "w", encoding="utf-8") as file:
                    file.write(response.text)

            print("Raw HTML saved.")
            print("Response size:", len(response.text))

            timestamps, values = extract_pm25_data(response.text)

            print("Requested:", start_time, "to", end_time)
            print("Raw timestamps:", len(timestamps))
            print("Raw values:", len(values))

            print("\nEXTRACTED DATA:")

            for timestamp, value in zip(timestamps, values):
                print(timestamp, "|", value)

            actual = set(timestamps)
            missing = sorted(set(expected) - actual)
            unexpected = sorted(actual - set(expected))

            print("\nMISSING TIMESTAMPS:")
            print(missing)

            print("\nUNEXPECTED TIMESTAMPS:")
            print(unexpected)

    except Exception as error:
        print("ERROR:", error)
