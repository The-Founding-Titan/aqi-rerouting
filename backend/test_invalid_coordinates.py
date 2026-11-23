from fastapi.testclient import TestClient
from main import app

client = TestClient(app)

test_cases = [
    ("Invalid latitude", 95, 77),
    ("Invalid longitude", 28, 200),
    ("Both invalid", 95, 200),
]

for name, latitude, longitude in test_cases:

    response = client.get(
        "/api/delhi/pm25-prediction",
        params={
            "latitude": latitude,
            "longitude": longitude,
        },
    )

    print(f"\n{name}")
    print("HTTP Status:", response.status_code)

    if response.status_code == 422:
        print("TEST PASSED: Invalid coordinates rejected.")
    else:
        print("TEST FAILED")
