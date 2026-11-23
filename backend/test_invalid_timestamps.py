from datetime import datetime, timedelta

from services.dpcc_service import (
    validate_observations,
    DPCCDataError,
    INDIA_TZ,
)

now = datetime.now(INDIA_TZ).replace(minute=0, second=0, microsecond=0)

timestamps = [(now - timedelta(hours=24 - i)).isoformat() for i in range(25)]

# Corrupt one timestamp deliberately
timestamps[10] = "not-a-valid-timestamp"

values = [80.0] * 25

print("Testing invalid DPCC timestamps...")

try:
    validate_observations(timestamps, values)

except DPCCDataError as error:
    print("\nEXPECTED FAILURE:", error)

    if "Invalid DPCC timestamp" in str(error):
        print("TEST PASSED: Invalid timestamp rejected.")
    else:
        print("TEST FAILED: Unexpected validation error.")

else:
    print("TEST FAILED: Invalid timestamp was accepted.")
