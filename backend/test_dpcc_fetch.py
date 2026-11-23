import requests
import re
import json

# ==========================================
# 1. DPCC CONFIGURATION
# ==========================================

URL = "https://www.dpccairdata.com/" "dpccairdata/display/AallAdvanceSearchMet.php"

params = {"stName": "RHdhcmthU2VjdHJvOA=="}

headers = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/156.0.0.0 Safari/537.36"
    ),
    "Accept": ("text/html,application/xhtml+xml,application/xml;" "q=0.9,*/*;q=0.8"),
    "Accept-Language": "en-US,en;q=0.9",
    "Origin": "https://www.dpccairdata.com",
    "Referer": (
        "https://www.dpccairdata.com/dpccairdata/display/"
        "AallAdvanceSearchMet.php?stName=Um9oaW5pU2VjdG9yMTY="
    ),
}

data = {
    "parameters": "PM25",
    "fDate": "2026-10-30 20:00",
    "eDate": "2026-10-31 21:00",
    "duration": "1",
    "graphType": "Line",
    "submit": "Search",
}


# ==========================================
# 2. ESTABLISH SESSION
# ==========================================

session = requests.Session()
session.headers.update(headers)

try:
    # Initial GET request
    get_response = session.get(URL, params=params, timeout=30)

    print("GET STATUS:", get_response.status_code)
    get_response.raise_for_status()

    # Submit PM2.5 form
    response = session.post(URL, params=params, data=data, timeout=30)

    print("POST STATUS:", response.status_code)
    print("RESPONSE SIZE:", len(response.text))

    response.raise_for_status()

    html = response.text

    # Save HTML for debugging
    with open("dpcc_response.html", "w", encoding="utf-8") as file:
        file.write(html)

    print("HTML saved successfully.")

    # ==========================================
    # 3. REMOVE JAVASCRIPT COMMENTS
    # ==========================================

    # Tokyo is inside a /* ... */ comment.
    # Remove comments before extracting chart data.

    clean_html = re.sub(r"/\*.*?\*/", "", html, flags=re.DOTALL)

    # ==========================================
    # 4. EXTRACT TIMESTAMPS
    # ==========================================

    categories_match = re.search(r"categories\s*:\s*\[(.*?)\]", clean_html, re.DOTALL)

    if not categories_match:
        raise ValueError("Chart timestamps not found.")

    timestamps = re.findall(r"""['"]([^'"]+)['"]""", categories_match.group(1))

    # ==========================================
    # 5. EXTRACT ACTUAL PM2.5 SERIES
    # ==========================================

    series_match = re.search(
        r"series\s*:\s*\[(.*?)\]\s*\}\s*\);", clean_html, re.DOTALL
    )

    if not series_match:
        raise ValueError("Chart series not found.")

    series_block = series_match.group(1)

    # Extract series name
    name_match = re.search(r"""name\s*:\s*['"]([^'"]+)['"]""", series_block)

    if not name_match:
        raise ValueError("Series name not found.")

    series_name = name_match.group(1)

    # Extract data array
    values_match = re.search(r"data\s*:\s*\[(.*?)\]", series_block, re.DOTALL)

    if not values_match:
        raise ValueError("PM2.5 data array not found.")

    values = [float(x) for x in re.findall(r"-?\d+(?:\.\d+)?", values_match.group(1))]

    # ==========================================
    # 6. VALIDATE RESULTS
    # ==========================================

    print("\n========== EXTRACTION RESULTS ==========")

    print("SERIES NAME:", series_name)
    print("TIMESTAMPS:", len(timestamps))
    print("PM2.5 VALUES:", len(values))

    if len(timestamps) != len(values):
        raise ValueError(
            f"Timestamp/value mismatch: "
            f"{len(timestamps)} timestamps, "
            f"{len(values)} values."
        )

    results = list(zip(timestamps, values))

    print("\nHOURLY PM2.5 DATA:")
    print(json.dumps(results, indent=2))

    print("\n========== VALIDATION ==========")

    print("FIRST TIMESTAMP:", timestamps[0])
    print("LAST TIMESTAMP:", timestamps[-1])

    if len(values) == 25:
        print("\nSUCCESS: All 25 PM2.5 readings extracted!")
    else:
        print(f"\nWARNING: Expected 25 readings, " f"received {len(values)}.")

except requests.RequestException as error:
    print("\nHTTP REQUEST ERROR:", error)

except ValueError as error:
    print("\nDATA EXTRACTION ERROR:", error)
