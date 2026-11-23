from datetime import datetime, timedelta

from services.dpcc_service import (
    validate_observations,
    DPCCDataError,
    INDIA_TZ,
)

# Generate 25 consecutive hourly timestamps,
# but make the latest observation 5 hours old.
now = datetime.now(INDIA_TZ).replace(minute=0, second=0, microsecond=0)

latest_time = now - timedelta(hours=5)

timestamps = [(latest_time - timedelta(hours=24 - i)).isoformat() for i in range(25)]

values = [80.0] * 25

print("Testing stale DPCC observations...")

try:
    validate_observations(timestamps, values)

except DPCCDataError as error:
    print("\nEXPECTED FAILURE:", error)

    if "more than 3 hours old" in str(error):
        print("TEST PASSED: Stale observations rejected.")
    else:
        print("TEST FAILED: Unexpected validation error.")

else:
    print("TEST FAILED: Stale observations were accepted.")
