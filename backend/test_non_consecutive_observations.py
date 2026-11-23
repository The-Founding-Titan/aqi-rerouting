from datetime import datetime, timedelta

from services.dpcc_service import (
    validate_observations,
    DPCCDataError,
    INDIA_TZ,
)

now = datetime.now(INDIA_TZ).replace(minute=0, second=0, microsecond=0)

timestamps = [now - timedelta(hours=24 - i) for i in range(25)]

# Introduce a 2-hour gap
timestamps[10] += timedelta(hours=1)

timestamps = [t.isoformat() for t in timestamps]

values = [80.0] * 25

print("Testing non-consecutive observations...")

try:
    validate_observations(timestamps, values)

except DPCCDataError as error:
    print("\nEXPECTED FAILURE:", error)

    if "not consecutive hourly readings" in str(error):
        print("TEST PASSED: Non-consecutive observations rejected.")
    else:
        print("TEST FAILED: Unexpected validation error.")

else:
    print("TEST FAILED: Non-consecutive observations accepted.")
