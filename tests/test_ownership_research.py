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
        self.assertEqual(len(public_records), 6)
        self.assertTrue(all(record["approvalStatus"] == "approved" for record in public_records))

    def test_default_registry_is_real_and_empty_demo_queue_cannot_be_approved(self):
        registry = research.load_registry(research.DEFAULT_REGISTRY)
        self.assertEqual(registry["dataStatus"], "real_research")
        self.assertEqual(len(registry["entities"]), 20)
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

    def test_real_historical_registry_matches_verified_overture_ids(self):
        listings = json.loads(research.LISTINGS.read_text(encoding="utf-8"))
        registry = research.load_registry(research.DEFAULT_REGISTRY)
        queue = research.generate_queue(listings, registry)
        expected = {
            "overture-af436b19-7ee9-48e7-ab77-b60f9a1d5dc5": "company-norfolk-air",
            "overture-7b4285da-a044-49a3-931d-536e6a91fd7a": "company-guy-smith",
            "overture-1d558b21-e9e5-46f4-8a32-b90fd4a12415": "company-comfort-solutions-tidewater",
            "overture-9e594c69-5dcc-46e7-bea7-e5c656d7198e": "company-smith-keene-home-services",
            "overture-25e8fd60-0c96-4709-99b4-338c93b048a2": "company-smith-keene-home-services",
            "overture-11f4ba78-3c4e-455c-a6ba-24e60e3d0a57": "company-hobbs-associates",
            "overture-91a5fbbf-2236-4922-8efe-8da5897f1074": "company-brr-refrigeration",
        }
        results = {entry["businessId"]: entry for entry in queue["entries"]}
        self.assertEqual(set(results), set(expected))
        for business_id, entity_id in expected.items():
            candidate, = results[business_id]["candidates"]
            self.assertEqual(candidate["entityId"], entity_id)
            if entity_id == "company-smith-keene-home-services":
                self.assertIn("website_domain", candidate["matchReasons"])
                self.assertNotIn("exact_normalized_name", candidate["matchReasons"])
                if business_id == "overture-9e594c69-5dcc-46e7-bea7-e5c656d7198e":
                    self.assertEqual(candidate["confidence"], 0.95)
                    self.assertIn("city", candidate["matchReasons"])
                else:
                    self.assertEqual(candidate["confidence"], 0.9)
                    self.assertNotIn("city", candidate["matchReasons"])
            elif entity_id == "company-brr-refrigeration":
                self.assertEqual(candidate["confidence"], 0.9)
                self.assertIn("exact_normalized_name", candidate["matchReasons"])
                self.assertIn("address", candidate["matchReasons"])
                self.assertIn("city", candidate["matchReasons"])
            else:
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
            "overture-9e594c69-5dcc-46e7-bea7-e5c656d7198e",
            "overture-11f4ba78-3c4e-455c-a6ba-24e60e3d0a57",
            "overture-91a5fbbf-2236-4922-8efe-8da5897f1074",
        })


class DiscoveryQueueTests(unittest.TestCase):
    def setUp(self):
        self.listings = json.loads(research.LISTINGS.read_text(encoding="utf-8"))
        self.registry = research.load_registry(research.DEFAULT_REGISTRY)
        self.public = json.loads(research.PUBLIC.read_text(encoding="utf-8"))
        self.source_leads = json.loads(research.SOURCE_LEADS.read_text(encoding="utf-8"))
        self.research_cases = json.loads(research.RESEARCH_CASES.read_text(encoding="utf-8"))
        self.public["records"] = [record for record in self.public["records"]
                                  if record["businessId"] != "overture-9e594c69-5dcc-46e7-bea7-e5c656d7198e"]
        self.queue = research.generate_discovery_queue(
            self.listings, self.registry, self.public, "2026-10-27", self.source_leads, self.research_cases)

    def test_all_unclassified_listings_are_queued_separately_from_approved_records(self):
        self.assertEqual(self.queue["totalHvacListings"], 293)
        self.assertEqual(self.queue["classifiedListings"], 5)
        self.assertEqual(self.queue["unclassifiedListings"], 288)
        self.assertEqual(self.queue["researchReadyListings"], 288)
        ids = [entry["businessId"] for entry in self.queue["entries"]]
        self.assertEqual(len(ids), len(set(ids)))
        self.assertFalse(set(ids) & {record["businessId"] for record in self.public["records"]})

    def test_related_listings_are_grouped_without_merging_or_classifying(self):
        self.assertFalse(self.queue["groupsAreMerges"])
        entries = {entry["businessId"]: entry for entry in self.queue["entries"]}
        for entry in entries.values():
            self.assertIsNone(entry["ownershipClassification"])
            self.assertEqual(entry["ownershipEvidence"], [])
            self.assertFalse(entry["signalsAreOwnershipEvidence"])
            self.assertEqual(entry["reviewStatus"], "unreviewed")
        grouped_ids = [business_id for group in self.queue["groups"] for business_id in group["businessIds"]]
        self.assertEqual(len(grouped_ids), len(set(grouped_ids)))
        self.assertTrue(all(group["suggestedSearchQueries"] for group in self.queue["groups"]))

    def test_report_prioritizes_deduplicated_research_tasks_and_shows_source_caveat(self):
        report = research.render_discovery_report(self.queue, 20)
        table = report.split("## Next research steps")[0]
        self.assertEqual(table.count("| 1 |"), 1)
        self.assertIn("Smith & Keene residential services carve-out", table)
        self.assertIn("ready_for_human_approval", table)
        self.assertNotIn("shared_phone", table)
        self.assertIn("not a business merge", table)

    def test_signal_normalization(self):
        self.assertEqual(research.normalized_phone("+1 (757) 555-0100"), "7575550100")
        self.assertEqual(research.domain("https://www.Example.com/path"), "example.com")

    def test_ownership_priority_is_independent_of_duplicate_signals(self):
        entries = {entry["businessId"]: entry for entry in self.queue["entries"]}
        smith_id = "overture-9e594c69-5dcc-46e7-bea7-e5c656d7198e"
        smith = entries[smith_id]
        self.assertEqual(smith["priorityScore"], 100)
        self.assertIn("documented acquisition", smith["priorityReasons"][0])
        routine = next(entry for entry in entries.values() if entry["relatedBusinessIds"] and not entry["researchCaseIds"])
        self.assertEqual(routine["priorityScore"], 0)
        self.assertTrue(routine["relatedBusinessIds"])

    def test_source_cases_distinguish_carveout_affiliation_and_franchise_operator(self):
        cases = {case["caseId"]: case for case in self.research_cases["candidates"]}
        smith = cases["case-smith-keene-cascade-2024"]
        self.assertEqual(smith["acquisition"]["announcedAt"], "2024-09-05")
        self.assertIsNone(smith["acquisition"]["effectiveAt"])
        self.assertIn("new-construction", smith["acquisition"]["scopeCaveat"])
        self.assertEqual(smith["identityLinks"][1]["status"], "identity_requires_review")
        philbrick = cases["case-philbrick-kellam-affiliation"]
        self.assertIsNone(philbrick["proposedClassification"])
        self.assertEqual(philbrick["documentedRelationship"]["transactionStructure"], "not established")
        one_hour = cases["case-one-hour-authority-franchise-network"]
        self.assertIsNone(one_hour["localOperator"]["identity"])
        self.assertIsNone(one_hour["proposedClassification"])

    def test_case_approval_is_manual_scoped_and_supports_multiple_business_ids(self):
        case_queue = {"researchCases": self.research_cases["candidates"]}
        case = case_queue["researchCases"][0]
        second_id = "overture-25e8fd60-0c96-4709-99b4-338c93b048a2"
        case["businessIds"].append(second_id)
        case["identityLinks"].append({"businessId": second_id, "status": "strong_source_location_match"})
        queue_next, public_next, registry_next = research.approve_research_case(
            case_queue, case["caseId"], case["businessIds"], "Test Reviewer", "2026-10-27",
            self.public, self.registry)
        records = [record for record in public_next["records"] if record["businessId"] in case["businessIds"]]
        self.assertEqual(len(records), 2)
        self.assertEqual(len({record["entityId"] for record in records}), 1)
        self.assertEqual(queue_next["researchCases"][0]["reviewStatus"], "approved")
        relation = next(item for item in registry_next["relationships"] if item["id"] == "rel-smith-keene-cascade-carveout")
        self.assertEqual(relation["transactionType"], "carveout")
        self.assertIsNone(relation["effectiveAt"])

    def test_unresolved_cases_cannot_be_approved(self):
        with self.assertRaisesRegex(ValueError, "not marked ready"):
            research.approve_research_case(
                {"researchCases": self.research_cases["candidates"]}, "case-philbrick-kellam-affiliation",
                ["overture-de2168af-df92-4094-bd32-9a279986bd0d"], "Reviewer", "2026-10-27",
                self.public, self.registry)


class AutomatedVerificationTests(unittest.TestCase):
    def setUp(self):
        self.listings = json.loads(research.LISTINGS.read_text(encoding="utf-8"))
        self.registry = research.load_registry(research.DEFAULT_REGISTRY)
        self.public = json.loads(research.PUBLIC.read_text(encoding="utf-8"))
        self.queue = json.loads(research.QUEUE.read_text(encoding="utf-8"))
        self.cases = json.loads(research.RESEARCH_CASES.read_text(encoding="utf-8"))["candidates"]

    def test_dry_run_is_read_only_and_reports_current_and_blocked_cases(self):
        before = json.dumps(self.public, sort_keys=True)
        plan = research.dry_run_auto_publication(self.listings, self.public, self.registry, self.cases, "2026-10-28")
        self.assertEqual(json.dumps(self.public, sort_keys=True), before)
        self.assertEqual(len(plan["proposedPublications"]), 0)
        self.assertEqual([item["caseId"] for item in plan["alreadyPublished"]], [
            "case-smith-keene-cascade-2024",
            "case-hobbs-air-blackstone-2024-2026",
            "case-brr-coolsys-ares-2019",
        ])
        blocked = {item["caseId"]: item for item in plan["blocked"]}
        self.assertIn("ultimate ownership", " ".join(blocked["case-philbrick-kellam-affiliation"]["blockers"]).lower())
        self.assertTrue(any("Franchise brand affiliation" in reason for reason in
                            blocked["case-one-hour-authority-franchise-network"]["blockers"]))
        smith = plan["alreadyPublished"][0]
        self.assertEqual(smith["businessIds"], ["overture-9e594c69-5dcc-46e7-bea7-e5c656d7198e"])
        self.assertEqual(smith["unselectedIdentityLinks"][0]["businessId"], "overture-25e8fd60-0c96-4709-99b4-338c93b048a2")

    def test_verified_smith_case_is_auto_eligible_when_not_yet_published(self):
        public = json.loads(json.dumps(self.public))
        public["records"] = [record for record in public["records"]
                             if record["businessId"] != "overture-9e594c69-5dcc-46e7-bea7-e5c656d7198e"]
        plan = research.dry_run_auto_publication(self.listings, public, self.registry, self.cases, "2026-10-28")
        eligible = next(item for item in plan["proposedPublications"] if item["caseId"] == "case-smith-keene-cascade-2024")
        self.assertEqual(eligible["classification"], "private_equity_backed")
        self.assertFalse(eligible["blockers"])

    def test_newport_identity_and_franchise_brand_alone_cannot_pass_gate(self):
        smith = json.loads(json.dumps(self.cases[0]))
        smith["businessIds"] = ["overture-25e8fd60-0c96-4709-99b4-338c93b048a2"]
        newport = research.evaluate_auto_case(smith, self.listings, self.public, self.registry, "2026-10-28")
        self.assertEqual(newport["status"], "blocked")
        self.assertTrue(any("identity is not verified" in item.lower() for item in newport["blockers"]))

        one_hour = json.loads(json.dumps(self.cases[2]))
        one_hour["proposedClassification"] = "private_equity_backed"
        franchise = research.evaluate_auto_case(one_hour, self.listings, self.public, self.registry, "2026-10-28")
        self.assertEqual(franchise["status"], "blocked")
        self.assertTrue(any("Franchise brand affiliation" in item for item in franchise["blockers"]))

    def test_auto_publish_snapshot_and_rollback_restore_only_published_record(self):
        public = json.loads(json.dumps(self.public))
        public["records"] = [record for record in public["records"]
                             if record["businessId"] != "overture-9e594c69-5dcc-46e7-bea7-e5c656d7198e"]
        registry = json.loads(json.dumps(self.registry))
        smith_case = self.cases[0]
        candidate_entity_ids = {entity["id"] for entity in smith_case["registryEntities"]}
        candidate_relationship_ids = {rel["id"] for rel in smith_case["registryRelationships"]}
        registry["entities"] = [entity for entity in registry["entities"] if entity["id"] not in candidate_entity_ids]
        registry["relationships"] = [rel for rel in registry["relationships"] if rel["id"] not in candidate_relationship_ids]
        before_ids = {record["businessId"] for record in public["records"]}
        before_entity_ids = {entity["id"] for entity in registry["entities"]}
        before_relationship_ids = {rel["id"] for rel in registry["relationships"]}
        public_next, registry_next, queue_next, plan, snapshot = research.publish_auto_eligible(
            self.listings, public, registry, self.queue, self.cases, {}, "2026-10-28")
        self.assertEqual(len(plan["proposedPublications"]), 1)
        self.assertEqual(len(public_next["records"]), len(public["records"]) + 1)
        self.assertIsNotNone(snapshot)
        self.assertTrue(snapshot["registryEntitiesAdded"])
        self.assertTrue(snapshot["registryRelationshipsAdded"])
        snapshot.pop("cache")
        restored_public, restored_registry, restored_queue, rolled_back = research.rollback_auto_publication(
            snapshot, public_next, registry_next, queue_next, "2026-10-28")
        self.assertEqual({record["businessId"] for record in restored_public["records"]}, before_ids)
        self.assertEqual(rolled_back["status"], "rolled_back")
        self.assertEqual({entity["id"] for entity in restored_registry["entities"]}, before_entity_ids)
        self.assertEqual({rel["id"] for rel in restored_registry["relationships"]}, before_relationship_ids)
        case = next(item for item in restored_queue["researchCases"] if item["caseId"] == "case-smith-keene-cascade-2024")
        self.assertEqual(case["reviewStatus"], "approved")

    def test_unchanged_evidence_fingerprints_are_cached(self):
        plan = research.dry_run_auto_publication(self.listings, self.public, self.registry, self.cases, "2026-10-28")
        cache = research.update_automation_cache({}, plan, "2026-10-28")
        self.assertTrue(cache["evidence"])
        same = research.update_automation_cache(cache, plan, "2026-10-29")
        smith = same["caseFingerprints"]["case-smith-keene-cascade-2024"]
        self.assertEqual(smith["unchangedRuns"], 1)
        self.assertTrue(all(item["unchangedRuns"] == 1 for item in same["evidence"].values()))


if __name__ == "__main__":
    unittest.main()
