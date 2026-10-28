import importlib.util
import json
import tempfile
import unittest
from pathlib import Path

SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "ownership_research.py"
spec = importlib.util.spec_from_file_location("ownership_research", SCRIPT)
research = importlib.util.module_from_spec(spec)
spec.loader.exec_module(research)


class MatchingTests(unittest.TestCase):
    def test_normalizes_names_domains_and_location(self):
        business = {"name": "Harbor-Breeze Heating", "website": "https://www.harborbreeze-demo.invalid/",
                    "city": "Norfolk", "address": "100 Demo Way"}
        entity = {"id": "demo", "name": "Harbor Breeze Mechanical", "brands": ["Harbor Breeze Heating"],
                  "websiteDomains": ["harborbreeze-demo.invalid"],
                  "locations": [{"city": "Norfolk", "address": "100 Demo Way"}]}
        confidence, reasons = research.score_match(business, entity)
        self.assertAlmostEqual(confidence, .95)
        self.assertIn("exact_normalized_name", reasons)
        self.assertIn("website_domain", reasons)
        self.assertIn("address", reasons)

    def test_city_alone_is_not_a_candidate(self):
        score, reasons = research.score_match({"name": "Some Business", "city": "Norfolk"},
                                               {"id": "x", "name": "Other Business", "locations": [{"city": "Norfolk"}]})
        self.assertEqual(score, 0)
        self.assertEqual(reasons, [])


class ApprovalSafeguardTests(unittest.TestCase):
    def test_public_dataset_rejects_unknown_and_fictional_evidence(self):
        base = {"schemaVersion": 1, "records": [{"businessId": "b", "classification": "unknown", "approvalStatus": "approved",
                "verifiedAt": "2026-01-01", "approvedAt": "2026-01-01", "approvedBy": "reviewer",
                "evidence": [{"url": "https://example.com"}]}]}
        with self.assertRaises(ValueError):
            research.validate_public(base)
        base["records"][0]["classification"] = "independent"
        base["records"][0]["evidence"][0]["fictional"] = True
        with self.assertRaises(ValueError):
            research.validate_public(base)
        base["records"][0]["evidence"][0].pop("fictional")
        base["records"][0]["approvalStatus"] = "pending"
        with self.assertRaisesRegex(ValueError, "explicitly approved"):
            research.validate_public(base)

    def test_real_records_are_untouched_and_fictional_demo_names_do_not_match(self):
        listings = json.loads(research.LISTINGS.read_text(encoding="utf-8"))
        registry = research.load_registry(research.ROOT / "data" / "ownershipRegistry.json")
        queue = research.generate_queue(listings, registry)
        self.assertEqual(queue["entries"], [])
        self.assertTrue(all(b["ownership"]["classification"] == "unknown" for b in listings["businesses"]))
        public_records = json.loads(research.PUBLIC.read_text(encoding="utf-8"))["records"]
        self.assertEqual(len(public_records), 3)
        self.assertTrue(all(record["approvalStatus"] == "approved" for record in public_records))

    def test_default_registry_is_real_and_empty_demo_queue_cannot_be_approved(self):
        registry = research.load_registry(research.DEFAULT_REGISTRY)
        self.assertEqual(registry["dataStatus"], "real_research")
        self.assertEqual(len(registry["entities"]), 7)
        with self.assertRaisesRegex(ValueError, "fictional demo"):
            research.require_approvable_queue({"registryDataStatus": "fictional_demo_only"})

    def test_registry_option_loads_selected_file(self):
        demo = research.load_registry(research.ROOT / "data" / "ownershipRegistry.json")
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "registry.json"
            path.write_text(json.dumps(demo), encoding="utf-8")
            selected = research.load_registry(path)
            self.assertEqual(selected["dataStatus"], "fictional_demo_only")
            queue = research.generate_queue({"businesses": []}, selected)
            queue["registryDataStatus"] = selected["dataStatus"]
            with self.assertRaisesRegex(ValueError, "fictional demo"):
                research.require_approvable_queue(queue)

    def test_real_historical_registry_matches_only_the_three_requested_overture_ids(self):
        listings = json.loads(research.LISTINGS.read_text(encoding="utf-8"))
        registry = research.load_registry(research.DEFAULT_REGISTRY)
        queue = research.generate_queue(listings, registry)
        expected = {
            "overture-af436b19-7ee9-48e7-ab77-b60f9a1d5dc5": "company-norfolk-air",
            "overture-7b4285da-a044-49a3-931d-536e6a91fd7a": "company-guy-smith",
            "overture-1d558b21-e9e5-46f4-8a32-b90fd4a12415": "company-comfort-solutions-tidewater",
        }
        results = {entry["businessId"]: entry for entry in queue["entries"]}
        self.assertEqual(set(results), set(expected))
        for business_id, entity_id in expected.items():
            candidate, = results[business_id]["candidates"]
            self.assertEqual(candidate["entityId"], entity_id)
            self.assertEqual(candidate["confidence"], 0.95)
            self.assertIn("exact_normalized_name", candidate["matchReasons"])
            self.assertIn("website_domain", candidate["matchReasons"])
            self.assertEqual(results[business_id]["reviewStatus"], "pending")
            self.assertFalse(results[business_id]["ownershipAssigned"])

    def test_registry_preserves_unknown_effective_dates_and_public_approvals(self):
        registry = research.load_registry(research.DEFAULT_REGISTRY)
        relationships = {r["id"]: r for r in registry["relationships"]}
        self.assertIsNone(relationships["rel-sila-goldman-investment"]["effectiveAt"])
        self.assertEqual(relationships["rel-sila-goldman-investment"]["announcedAt"], "2024-11-12")
        self.assertIsNone(relationships["rel-norfolk-air-sila-acquisition"]["effectiveAt"])
        self.assertEqual(relationships["rel-comfort-solutions-paramount-acquisition"]["effectiveAt"], "2025-05-01")
        self.assertEqual(relationships["rel-paramount-stonebridge-investment"]["effectiveAt"], "2021-03-11")
        records = json.loads(research.PUBLIC.read_text(encoding="utf-8"))["records"]
        self.assertEqual({record["businessId"] for record in records}, {
            "overture-af436b19-7ee9-48e7-ab77-b60f9a1d5dc5",
            "overture-7b4285da-a044-49a3-931d-536e6a91fd7a",
            "overture-1d558b21-e9e5-46f4-8a32-b90fd4a12415",
        })


if __name__ == "__main__":
    unittest.main()
