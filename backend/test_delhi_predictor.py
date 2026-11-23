from delhi_ml.predictor import DelhiPM25Predictor

predictor = DelhiPM25Predictor()

print("Loading Delhi ML model...")
predictor.load()

print("Model loaded successfully!")

# Sample hourly observations for testing.
# Replace these with actual DPCC readings for production.
observations = [
    {"timestamp": f"2026-10-30 {hour:02d}:00:00", "pm25": value}
    for hour, value in [
        (21, 68),
        (22, 67),
        (23, 70),
    ]
]

# Continue with the next calendar day.
observations += [
    {"timestamp": f"2026-10-31 {hour:02d}:00:00", "pm25": value}
    for hour, value in [
        (0, 68),
        (1, 66),
        (2, 56),
        (3, 48),
        (4, 48),
        (5, 35),
        (6, 45),
        (7, 38),
        (8, 38),
        (9, 38),
        (10, 41),
        (11, 46),
        (12, 66),
        (13, 81),
        (14, 101),
        (15, 101),
        (16, 86),
        (17, 84),
        (18, 85),
        (19, 110),
        (20, 141),
        (21, 162),
    ]
]

print("\nGenerating next-hour prediction...")

result = predictor.predict(observations)

print("\n========== PREDICTION RESULT ==========")
print("Pollutant:", result["pollutant"])
print("Prediction:", result["prediction"], result["unit"])
print("Prediction for:", result["prediction_for"])
print("Input timestamp:", result["input_timestamp"])

print("\n========== FEATURES ==========")
for feature, value in result["features"].items():
    print(f"{feature}: {value}")
