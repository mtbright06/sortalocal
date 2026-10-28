import importlib.util
import json
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
        base = {"schemaVersion": 1, "records": [{"businessId": "b", "classification": "unknown",
                "verifiedAt": "2026-01-01", "approvedAt": "2026-01-01", "approvedBy": "reviewer",
                "evidence": [{"url": "https://example.com"}]}]}
        with self.assertRaises(ValueError):
            research.validate_public(base)
        base["records"][0]["classification"] = "independent"
        base["records"][0]["evidence"][0]["fictional"] = True
        with self.assertRaises(ValueError):
            research.validate_public(base)

    def test_real_records_are_untouched_and_fictional_demo_names_do_not_match(self):
        listings = json.loads(research.LISTINGS.read_text(encoding="utf-8"))
        registry = json.loads(research.REGISTRY.read_text(encoding="utf-8"))
        queue = research.generate_queue(listings, registry)
        self.assertEqual(queue["entries"], [])
        self.assertTrue(all(b["ownership"]["classification"] == "unknown" for b in listings["businesses"]))
        self.assertEqual(json.loads(research.PUBLIC.read_text(encoding="utf-8"))["records"], [])


if __name__ == "__main__":
    unittest.main()
