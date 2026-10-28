from __future__ import annotations

import argparse
import csv
import io
import json
import tempfile
import urllib.request
import zipfile
from pathlib import Path
from typing import Any

from import_overture_hvac import (
    DEFAULT_BBOX,
    DEFAULT_RELEASE,
    TARGET_CITIES,
    city_polygons,
    download_geojson,
    point_in_geometry,
    read_features,
)

GAZETTEER_URL = "https://www2.census.gov/geo/docs/maps-data/data/gazetteer/2026_Gazetteer/2026_Gaz_zcta_national.zip"
OUTPUT_PATH = Path(__file__).resolve().parents[1] / "src" / "hamptonRoadsZipCentroids.json"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Build the local Hampton Roads ZIP centroid lookup.")
    parser.add_argument("--output", type=Path, default=OUTPUT_PATH, help="Generated JSON path.")
    return parser.parse_args()


def load_centroids(polygons: dict[str, dict[str, Any]]) -> dict[str, dict[str, Any]]:
    with urllib.request.urlopen(GAZETTEER_URL, timeout=60) as response:
        archive_bytes = response.read()

    with zipfile.ZipFile(io.BytesIO(archive_bytes)) as archive:
        data_file = next(name for name in archive.namelist() if name.endswith(".txt"))
        with archive.open(data_file) as data_stream:
            rows = csv.DictReader(io.TextIOWrapper(data_stream, encoding="utf-8"), delimiter="|")
            centroids = {}
            for row in rows:
                postal_code = row["GEOID"]
                latitude = float(row["INTPTLAT"])
                longitude = float(row["INTPTLONG"])
                point = (longitude, latitude)
                city = next((name for name, geometry in polygons.items() if point_in_geometry(point, geometry)), None)
                if len(postal_code) == 5 and city:
                    centroids[postal_code] = {"latitude": latitude, "longitude": longitude, "city": city}

    if not centroids:
        raise ValueError("No Hampton Roads ZCTAs found in the Census Gazetteer")
    return dict(sorted(centroids.items()))


def main() -> None:
    args = parse_args()
    with tempfile.TemporaryDirectory(prefix="sortalocal-zip-boundaries-") as temporary_directory:
        boundary_path = Path(temporary_directory) / "division_areas.geojson"
        download_geojson("division_area", DEFAULT_BBOX, DEFAULT_RELEASE, boundary_path)
        polygons = city_polygons(read_features(boundary_path))
    data = {
        "source": "U.S. Census Bureau 2026 ZCTA Gazetteer",
        "sourceUrl": GAZETTEER_URL,
        "sourceNote": "Representative internal points for Census ZIP Code Tabulation Areas; not every USPS ZIP is represented and ZCTAs are not exact USPS delivery areas.",
        "targetCities": list(TARGET_CITIES),
        "overtureBoundaryRelease": DEFAULT_RELEASE,
        "centroids": load_centroids(polygons),
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")
    print(f"Wrote {len(data['centroids'])} Hampton Roads ZCTA centroids to {args.output}")


if __name__ == "__main__":
    main()
