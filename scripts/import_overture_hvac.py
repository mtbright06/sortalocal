from __future__ import annotations

import argparse
import json
import math
import re
import subprocess
import sys
import tempfile
from collections import Counter
from difflib import SequenceMatcher
from pathlib import Path
from typing import Any

DEFAULT_RELEASE = "2026-10-21.0"
DEFAULT_BBOX = "-76.95,36.55,-76.02,37.14"
TARGET_CITIES = ("Suffolk", "Chesapeake", "Portsmouth", "Norfolk")
OVERTURE_HVAC_PRIMARY = "hvac_service"
OVERTURE_HOME_SERVICE = "home_service"
COMBINED_HVAC_TERMS = ("hvac", "heating", "cooling", "air conditioning")
KNOWN_FALSE_POSITIVES = {
    "72b260a2-0f00-4d40-b320-a0976ece1568": "Healthcare practitioner misclassified as HVAC service",
    "b283a586-4f5d-4fe5-a0e4-d65f469d5489": "Climate-control equipment rental, not HVAC contracting/service",
    "d9565fe4-0b30-48ee-90bc-3b59e079cd86": "HVAC equipment distributor, not HVAC contracting/service",
    "978149ff-c52d-485e-a57a-58c2f481b211": "HVAC equipment distributor, not HVAC contracting/service",
    "2d376d97-243a-402f-adf8-6ff609f49187": "HVAC equipment distributor, not HVAC contracting/service",
}
OUTPUT_PATH = Path(__file__).resolve().parents[1] / "src" / "overtureHvacListings.json"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Import HVAC service listings from Overture Maps Places.")
    parser.add_argument("--release", default=DEFAULT_RELEASE, help="Pinned Overture release (default: %(default)s).")
    parser.add_argument("--bbox", default=DEFAULT_BBOX, help="Download bbox in west,south,east,north order.")
    parser.add_argument("--output", type=Path, default=OUTPUT_PATH, help="Generated JSON path.")
    return parser.parse_args()


def download_geojson(feature_type: str, bbox: str, release: str, output: Path) -> None:
    command = [
        sys.executable,
        "-m",
        "overturemaps",
        "download",
        f"--bbox={bbox}",
        f"--release={release}",
        "--type",
        feature_type,
        "-f",
        "geojson",
        "-o",
        str(output),
    ]
    subprocess.run(command, check=True)


def read_features(path: Path) -> list[dict[str, Any]]:
    with path.open(encoding="utf-8") as source:
        document = json.load(source)
    if document.get("type") != "FeatureCollection" or not isinstance(document.get("features"), list):
        raise ValueError(f"Expected a GeoJSON FeatureCollection in {path}")
    return document["features"]


def city_polygons(area_features: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    targets: dict[str, dict[str, Any]] = {}
    for feature in area_features:
        properties = feature.get("properties") or {}
        name = (properties.get("names") or {}).get("primary")
        if (
            name in TARGET_CITIES
            and properties.get("country") == "US"
            and properties.get("region") == "US-VA"
            and properties.get("subtype") in {"county", "locality"}
            and feature.get("geometry", {}).get("type") in {"Polygon", "MultiPolygon"}
        ):
            targets[name] = feature["geometry"]

    missing = set(TARGET_CITIES) - targets.keys()
    if missing:
        raise ValueError(f"Missing Overture city boundary areas: {', '.join(sorted(missing))}")
    return targets


def point_on_segment(x: float, y: float, start: list[float], end: list[float]) -> bool:
    cross = (x - start[0]) * (end[1] - start[1]) - (y - start[1]) * (end[0] - start[0])
    if abs(cross) > 1e-10:
        return False
    return (
        min(start[0], end[0]) - 1e-10 <= x <= max(start[0], end[0]) + 1e-10
        and min(start[1], end[1]) - 1e-10 <= y <= max(start[1], end[1]) + 1e-10
    )


def point_in_ring(point: tuple[float, float], ring: list[list[float]]) -> bool:
    x, y = point
    inside = False
    for start, end in zip(ring, ring[1:]):
        if point_on_segment(x, y, start, end):
            return True
        if (start[1] > y) != (end[1] > y):
            crossing_x = (end[0] - start[0]) * (y - start[1]) / (end[1] - start[1]) + start[0]
            if x < crossing_x:
                inside = not inside
    return inside


def point_in_polygon(point: tuple[float, float], rings: list[list[list[float]]]) -> bool:
    return bool(rings) and point_in_ring(point, rings[0]) and not any(
        point_in_ring(point, hole) for hole in rings[1:]
    )


def point_in_geometry(point: tuple[float, float], geometry: dict[str, Any]) -> bool:
    coordinates = geometry.get("coordinates") or []
    if geometry.get("type") == "Polygon":
        return point_in_polygon(point, coordinates)
    if geometry.get("type") == "MultiPolygon":
        return any(point_in_polygon(point, polygon) for polygon in coordinates)
    return False


def city_for_point(point: tuple[float, float], polygons: dict[str, dict[str, Any]]) -> str | None:
    return next((city for city, geometry in polygons.items() if point_in_geometry(point, geometry)), None)


def first_nonempty(values: Any) -> str | None:
    if not isinstance(values, list):
        return None
    return next((value.strip() for value in values if isinstance(value, str) and value.strip()), None)


def normalize(value: str | None) -> str:
    if not value:
        return ""
    normalized = value.casefold().replace("&", " and ")
    return re.sub(r"[^a-z0-9]+", "", normalized)


def distance_meters(left: dict[str, Any], right: dict[str, Any]) -> float:
    lat1, lat2 = math.radians(left["latitude"]), math.radians(right["latitude"])
    delta_lat = lat2 - lat1
    delta_lon = math.radians(right["longitude"] - left["longitude"])
    haversine = math.sin(delta_lat / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin(delta_lon / 2) ** 2
    return 6_371_000 * 2 * math.asin(math.sqrt(haversine))


def is_duplicate(candidate: dict[str, Any], existing: dict[str, Any]) -> bool:
    same_name = normalize(candidate["name"]) == normalize(existing["name"])
    same_address = normalize(candidate.get("address")) == normalize(existing.get("address"))
    if same_name and same_address and candidate.get("address"):
        return True
    if not same_name or distance_meters(candidate, existing) > 30:
        return False
    return SequenceMatcher(None, normalize(candidate["name"]), normalize(existing["name"])).ratio() >= 0.92


def make_business(feature: dict[str, Any], city: str, match_reason: str) -> dict[str, Any] | None:
    properties = feature.get("properties") or {}
    name = ((properties.get("names") or {}).get("primary") or "").strip()
    coordinates = (feature.get("geometry") or {}).get("coordinates")
    if not name or not isinstance(coordinates, list) or len(coordinates) < 2:
        return None
    longitude, latitude = coordinates[:2]
    if not isinstance(longitude, (int, float)) or not isinstance(latitude, (int, float)):
        return None
    if not math.isfinite(longitude) or not math.isfinite(latitude):
        return None

    address_record = next(iter(properties.get("addresses") or []), {})
    address = address_record.get("freeform") if isinstance(address_record, dict) else None
    phone = first_nonempty(properties.get("phones"))
    website = first_nonempty(properties.get("websites"))
    if website and not website.startswith(("https://", "http://")):
        website = None
    sources = properties.get("sources") or []
    source = next((entry for entry in sources if isinstance(entry, dict) and entry.get("dataset") not in {None, "Overture", "Overture-signals"}), {})
    incomplete_fields = [field for field, value in (("address", address), ("phone", phone), ("website", website)) if not value]

    return {
        "id": f"overture-{feature.get('id')}",
        "name": name,
        "category": "hvac",
        "address": address,
        "city": city,
        "latitude": latitude,
        "longitude": longitude,
        "phone": phone,
        "website": website,
        "dataSource": "overture",
        "sourceId": feature.get("id"),
        "sourceDataset": source.get("dataset"),
        "sourceRecordId": source.get("record_id"),
        "sourceRelease": DEFAULT_RELEASE,
        "overtureTaxonomyPrimary": (properties.get("taxonomy") or {}).get("primary"),
        "overtureMatchReason": match_reason,
        "incompleteFields": incomplete_fields,
        "ownership": {
            "classification": "unknown",
            "status": "unknown",
            "verifiedAt": None,
            "relationships": [],
            "evidence": [],
        },
    }


def hvac_match_reason(properties: dict[str, Any]) -> str | None:
    taxonomy = properties.get("taxonomy") or {}
    hierarchy = taxonomy.get("hierarchy") or []
    primary = taxonomy.get("primary")
    alternates = taxonomy.get("alternates") or []
    if properties.get("basic_category") != OVERTURE_HOME_SERVICE:
        return None
    if primary == OVERTURE_HVAC_PRIMARY and OVERTURE_HVAC_PRIMARY in hierarchy:
        return "taxonomy_primary_hvac_service"
    if isinstance(alternates, list) and OVERTURE_HVAC_PRIMARY in alternates:
        return "taxonomy_alternate_hvac_service"

    name = ((properties.get("names") or {}).get("primary") or "").casefold()
    if primary == "plumbing" and OVERTURE_HOME_SERVICE in hierarchy and any(term in name for term in COMBINED_HVAC_TERMS):
        return "combined_plumbing_and_hvac_name"
    return None


def import_records(place_features: list[dict[str, Any]], polygons: dict[str, dict[str, Any]]) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    match_counts: Counter[str] = Counter()
    in_city_records: list[tuple[str, dict[str, Any], str]] = []
    outside_city = 0
    invalid_features = 0
    for feature in place_features:
        properties = feature.get("properties") or {}
        match_reason = hvac_match_reason(properties)
        if match_reason is None:
            continue
        match_counts[match_reason] += 1
        geometry = feature.get("geometry") or {}
        coordinates = geometry.get("coordinates") or []
        if geometry.get("type") != "Point" or len(coordinates) < 2:
            invalid_features += 1
            continue
        city = city_for_point((coordinates[0], coordinates[1]), polygons)
        if city is None:
            outside_city += 1
            continue
        in_city_records.append((city, feature, match_reason))

    excluded_outliers: list[dict[str, str]] = []
    duplicate_count = 0
    businesses: list[dict[str, Any]] = []
    per_city: Counter[str] = Counter()
    for city, feature, match_reason in in_city_records:
        source_id = feature.get("id")
        if source_id in KNOWN_FALSE_POSITIVES:
            excluded_outliers.append({"sourceId": source_id, "reason": KNOWN_FALSE_POSITIVES[source_id]})
            continue
        business = make_business(feature, city, match_reason)
        if business is None:
            invalid_features += 1
            continue
        duplicate = next((existing for existing in businesses if is_duplicate(business, existing)), None)
        if duplicate:
            duplicate_count += 1
            continue
        businesses.append(business)
        per_city[city] += 1

    city_candidates = len(in_city_records)
    incomplete_counts: Counter[str] = Counter()
    for business in businesses:
        incomplete_counts.update(business["incompleteFields"])
    summary = {
        "release": DEFAULT_RELEASE,
        "source": "Overture Maps Places",
        "sourceUrl": "https://overturemaps.org/",
        "taxonomyFilter": "taxonomy.primary=hvac_service or taxonomy.alternates includes hvac_service; combined plumbing is included only when taxonomy.primary=plumbing, hierarchy includes home_service, basic_category=home_service, and the Overture primary name explicitly contains HVAC/heating/cooling/air conditioning",
        "targetCities": list(TARGET_CITIES),
        "downloadBbox": DEFAULT_BBOX,
        "downloadedPlaceFeatures": len(place_features),
        "taxonomyPrimaryMatches": match_counts["taxonomy_primary_hvac_service"],
        "taxonomyAlternateMatches": match_counts["taxonomy_alternate_hvac_service"],
        "combinedServiceMatches": match_counts["combined_plumbing_and_hvac_name"],
        "excludedOutsideTargetCities": outside_city,
        "insideTargetCityBoundaries": city_candidates,
        "excludedInvalidRecords": invalid_features,
        "excludedKnownFalsePositives": excluded_outliers,
        "excludedDuplicates": duplicate_count,
        "importedRecords": len(businesses),
        "importedByCity": {city: per_city.get(city, 0) for city in TARGET_CITIES},
        "incompleteRecords": sum(bool(business["incompleteFields"]) for business in businesses),
        "missingFields": {field: incomplete_counts[field] for field in ("address", "phone", "website")},
        "ownership": "unknown for every imported record; no ownership relationships or evidence imported",
        "deduplication": "same normalized business name plus same address, or same name within 30 meters",
    }
    return businesses, summary


def main() -> None:
    args = parse_args()
    with tempfile.TemporaryDirectory(prefix="sortalocal-overture-") as temporary_directory:
        temporary_path = Path(temporary_directory)
        place_path = temporary_path / "places.geojson"
        area_path = temporary_path / "division_areas.geojson"
        download_geojson("place", args.bbox, args.release, place_path)
        download_geojson("division_area", args.bbox, args.release, area_path)
        places = read_features(place_path)
        polygons = city_polygons(read_features(area_path))
        businesses, summary = import_records(places, polygons)

    summary["release"] = args.release
    summary["downloadBbox"] = args.bbox
    for business in businesses:
        business["sourceRelease"] = args.release
    output = {"release": args.release, "summary": summary, "businesses": businesses}
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(output, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(summary, indent=2))
    print(f"Wrote {len(businesses)} HVAC listings to {args.output}")


if __name__ == "__main__":
    main()
