import importlib.util
import json
import unittest
from pathlib import Path

SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "import_overture_hvac.py"
spec = importlib.util.spec_from_file_location("import_overture", SCRIPT)
importer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(importer)


def feature(source_id, name, category, longitude=0.5, latitude=0.5, confidence=0.95,
            alternates=None, address="1 Main St"):
    hierarchy = ["health_care", category] if category in {"dental_clinic", "general_dentistry"} else [category]
    return {
        "type": "Feature",
        "id": source_id,
        "geometry": {"type": "Point", "coordinates": [longitude, latitude]},
        "properties": {
            "names": {"primary": name},
            "taxonomy": {"primary": category, "hierarchy": hierarchy, "alternates": alternates or []},
            "basic_category": category,
            "confidence": confidence,
            "addresses": [{"freeform": address}],
            "phones": ["757-555-0111"],
            "websites": ["https://example.test"],
            "sources": [{"dataset": "Meta", "record_id": source_id}],
        },
    }


class OvertureImporterTests(unittest.TestCase):
    def setUp(self):
        self.polygons = {"Norfolk": {"type": "Polygon", "coordinates": [[
            [0, 0], [1, 0], [1, 1], [0, 1], [0, 0],
        ]]}}

    def test_dental_categories_import_with_unknown_ownership_and_city_count(self):
        places = [feature("d1", "Tidewater Dentistry", "general_dentistry")]
        businesses, summary = importer.import_records(places, self.polygons, "dental", "test-release")
        self.assertEqual(len(businesses), 1)
        self.assertEqual(businesses[0]["category"], "dental")
        self.assertEqual(businesses[0]["ownership"]["classification"], "unknown")
        self.assertEqual(businesses[0]["sourceRelease"], "test-release")
        self.assertEqual(summary["importedByCity"], {city: (1 if city == "Norfolk" else 0)
                                                       for city in importer.TARGET_CITIES})

    def test_veterinary_training_and_nonlocal_records_are_excluded(self):
        places = [
            feature("v1", "Norfolk Animal Hospital", "animal_hospital"),
            feature("v2", "Pecan Grove GunDogs", "veterinarian"),
            feature("v3", "Outside Vet Clinic", "veterinarian", longitude=2.0),
        ]
        businesses, summary = importer.import_records(places, self.polygons, "veterinary")
        self.assertEqual([business["sourceId"] for business in businesses], ["v1"])
        self.assertEqual(summary["excludedOutsideTargetCities"], 1)
        self.assertEqual(len(summary["excludedIndustryFalsePositives"]), 1)

    def test_auto_repair_includes_specialists_and_excludes_dealers(self):
        places = [
            feature("a1", "Norfolk Tire Shop", "tire_shop"),
            feature("a2", "First Team Kia", "automotive_repair"),
            feature("a3", "Shop with dealer category", "automotive_repair", alternates=["car_dealer"]),
        ]
        businesses, summary = importer.import_records(places, self.polygons, "auto-repair")
        self.assertEqual([business["sourceId"] for business in businesses], ["a1"])
        self.assertEqual(len(summary["excludedIndustryFalsePositives"]), 2)
        self.assertEqual(businesses[0]["category"], "automotive")

    def test_deduplication_and_incomplete_fields_are_reported(self):
        first = feature("d1", "Same Dental", "dental_clinic")
        duplicate = feature("d2", "Same Dental", "dental_clinic")
        missing = feature("d3", "New Dental", "dental_clinic", address=None)
        missing["properties"]["phones"] = []
        businesses, summary = importer.import_records([first, duplicate, missing], self.polygons, "dental")
        self.assertEqual(len(businesses), 2)
        self.assertEqual(summary["excludedDuplicates"], 1)
        self.assertEqual(summary["incompleteRecords"], 1)
        self.assertEqual(summary["missingFields"]["address"], 1)
        self.assertEqual(summary["missingFields"]["phone"], 1)

    def test_hvac_filter_and_existing_293_records_remain_available(self):
        places = [feature("h1", "Test Heating", "hvac_service")]
        places[0]["properties"].update({"basic_category": "home_service",
                                        "taxonomy": {"primary": "hvac_service", "hierarchy": ["home_service", "hvac_service"]}})
        businesses, _ = importer.import_records(places, self.polygons, "hvac")
        self.assertEqual(len(businesses), 1)
        data = json.loads((SCRIPT.parents[1] / "src" / "overtureHvacListings.json").read_text())
        self.assertEqual(len(data["businesses"]), 293)


if __name__ == "__main__":
    unittest.main()
