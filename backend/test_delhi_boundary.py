from geo.boundary_service import is_inside_delhi

locations = {
    "Connaught Place": (28.6315, 77.2167, True),
    "India Gate": (28.6129, 77.2295, True),
    "Gurugram": (28.4595, 77.0266, False),
    "Noida": (28.5355, 77.3910, False),
}

for name, (lat, lon, expected) in locations.items():
    result = is_inside_delhi(lat, lon)
    print(f"{name}: {result}")
    assert result == expected, f"{name} classification failed!"

print("\nAll boundary tests passed!")
