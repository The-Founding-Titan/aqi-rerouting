import json
from pathlib import Path

from shapely.geometry import Point, shape
from shapely.ops import unary_union

BOUNDARY_FILE = Path(__file__).parent / "delhi_boundary.geojson"


def load_delhi_boundary():
    with open(BOUNDARY_FILE, "r", encoding="utf-8") as file:
        data = json.load(file)

    geometries = [
        shape(feature["geometry"])
        for feature in data["features"]
        if feature.get("geometry")
    ]

    if not geometries:
        raise ValueError("Delhi boundary GeoJSON contains no geometries.")

    boundary = unary_union(geometries)

    if not boundary.is_valid:
        raise ValueError("Delhi boundary geometry is invalid.")

    return boundary


DELHI_BOUNDARY = load_delhi_boundary()


def is_inside_delhi(latitude: float, longitude: float) -> bool:
    point = Point(longitude, latitude)
    return DELHI_BOUNDARY.covers(point)
