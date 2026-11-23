from datetime import datetime, timedelta

from services.dpcc_service import (
    validate_observations,
    DPCCDataError,
)

# Generate only 20 consecutive hourly observations
now = datetime.now().replace(minute=0, second=0, microsecond=0)

timestamps = [(now - timedelta(hours=19 - i)).isoformat() for i in range(20)]

values = [80.0] * 20

print("Testing incomplete DPCC observations...")

try:
    validate_observations(timestamps, values)

except DPCCDataError as error:
    print("\nEXPECTED FAILURE:", error)

    if "Expected 25 observations" in str(error):
        print("TEST PASSED: Incomplete observations rejected.")
    else:
        print("TEST FAILED: Unexpected validation error.")

else:
    print("TEST FAILED: Incomplete observations were accepted.")
