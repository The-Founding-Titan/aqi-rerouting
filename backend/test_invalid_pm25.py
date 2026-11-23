from datetime import datetime, timedelta

from services.dpcc_service import (
    validate_observations,
    DPCCDataError,
    INDIA_TZ,
)

now = datetime.now(INDIA_TZ).replace(minute=0, second=0, microsecond=0)

timestamps = [(now - timedelta(hours=24 - i)).isoformat() for i in range(25)]


test_cases = {
    "Negative PM2.5": -10.0,
    "NaN PM2.5": float("nan"),
    "Infinite PM2.5": float("inf"),
}


for name, invalid_value in test_cases.items():

    values = [80.0] * 25
    values[10] = invalid_value

    print(f"\nTesting: {name}")

    try:
        validate_observations(timestamps, values)

    except DPCCDataError as error:
        print("EXPECTED FAILURE:", error)
        print("TEST PASSED")

    else:
        print("TEST FAILED: Invalid value accepted")
