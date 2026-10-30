#!/usr/bin/env python3
"""Ownership research, evidence-gated publication, audit snapshots, and rollback; no network calls."""
from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
from datetime import date, datetime, timezone
from collections import defaultdict
from difflib import SequenceMatcher
from pathlib import Path
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parents[1]
LISTINGS = ROOT / "src" / "overtureHvacListings.json"
INDUSTRY_LISTINGS = {
    "hvac": LISTINGS,
    "dental": ROOT / "src" / "overtureDentalListings.json",
    "veterinary": ROOT / "src" / "overtureVeterinaryListings.json",
    "automotive": ROOT / "src" / "overtureAutoRepairListings.json",
}
DEFAULT_REGISTRY = ROOT / "data" / "realOwnershipRegistry.json"
QUEUE = ROOT / "data" / "ownershipResearchQueue.json"
PUBLIC = ROOT / "data" / "publicOwnership.json"
DISCOVERY_QUEUE = ROOT / "data" / "hvacOwnershipDiscoveryQueue.json"
DISCOVERY_REPORT = ROOT / "reports" / "hvac-ownership-discovery-top20.md"
SOURCE_LEADS = ROOT / "data" / "hvacOwnershipSourceLeads.json"
RESEARCH_CASES = ROOT / "data" / "ownershipResearchCases.json"
AUTOMATION_CONFIG = ROOT / "data" / "ownershipAutomationConfig.json"
AUTOMATION_CACHE = ROOT / "data" / "ownershipVerificationCache.json"
OWNERSHIP_SNAPSHOTS = ROOT / "data" / "ownershipSnapshots"
CLASSES = {"independent", "private_equity_backed", "public_company", "subsidiary", "unknown"}


def load(path: Path):
    with path.open(encoding="utf-8") as f:
        return json.load(f)


def load_all_overture_listings() -> dict:
    """Load existing industry datasets for case identity checks; no import or merge occurs."""
    businesses = []
    for path in INDUSTRY_LISTINGS.values():
        businesses.extend(load(path).get("businesses", []))
    return {"businesses": businesses}


def load_registry(path: Path) -> dict:
    registry = load(path)
    if registry.get("schemaVersion") != 1 or not isinstance(registry.get("entities"), list):
        raise ValueError("Invalid ownership registry schema")
    if registry.get("dataStatus") not in {"real_research", "fictional_demo_only"}:
        raise ValueError("Registry must explicitly declare dataStatus")
    return registry


def norm(value: str | None) -> str:
    return " ".join(re.findall(r"[a-z0-9]+", (value or "").casefold()))


def domain(value: str | None) -> str:
    if not value:
        return ""
    parsed = urlparse(value if "://" in value else "//" + value)
    host = (parsed.hostname or "").lower().removeprefix("www.")
    return host


def score_match(business: dict, entity: dict) -> tuple[float, list[str]]:
    reasons: list[str] = []
    name = norm(business.get("name"))
    names = [entity.get("name", ""), *entity.get("brands", [])]
    normalized = {norm(n) for n in names if n}
    if name and name in normalized:
        reasons.append("exact_normalized_name")
    elif name:
        best = max((SequenceMatcher(None, name, n).ratio() for n in normalized), default=0)
        if best >= 0.90:
            reasons.append(f"similar_name:{best:.2f}")
    site = domain(business.get("website"))
    if site and site in {domain(d) for d in entity.get("websiteDomains", [])}:
        reasons.append("website_domain")
    city = norm(business.get("city"))
    address = norm(business.get("address"))
    city_match = False
    for loc in entity.get("locations", []):
        if city and city == norm(loc.get("city")):
            city_match = True
        if address and address == norm(loc.get("address")):
            reasons.append("address")
    # Registry parent and brand links are useful context, never proof of ownership.
    if business.get("parentEntityId") == entity.get("id") or entity.get("id") in business.get("relatedEntityIds", []):
        reasons.append("known_parent_or_brand_link")
    # Location corroborates an actual name/domain/address/link signal; city alone is too broad.
    if city_match and reasons:
        reasons.append("city")
    weights = {"exact_normalized_name": .70, "website_domain": .90, "address": .85, "city": .10,
               "known_parent_or_brand_link": .95}
    confidence = min(.99, max((weights.get(r, float(r.split(":")[1]) * .65) if r.startswith("similar_name:") else weights.get(r, 0) for r in reasons), default=0))
    if "city" in reasons and len(reasons) > 1:
        confidence = min(.99, confidence + .05)
    return confidence, reasons


def generate_queue(listings: dict, registry: dict) -> dict:
    entities = registry["entities"]
    entries = []
    for business in listings["businesses"]:
        candidates = []
        for entity in entities:
            confidence, reasons = score_match(business, entity)
            if reasons:
                candidates.append({"entityId": entity["id"], "entityName": entity["name"],
                                   "confidence": round(confidence, 2), "matchReasons": reasons})
        candidates.sort(key=lambda x: (-x["confidence"], x["entityId"]))
        if candidates:
            entries.append({"businessId": business["id"], "businessName": business["name"],
                            "city": business.get("city"), "candidates": candidates,
                            "reviewStatus": "pending", "ownershipAssigned": False})
    return {"schemaVersion": 1, "generatedAt": date.today().isoformat(),
            "source": "Overture Maps; candidate links are unverified and do not assign ownership",
            "entries": entries}


def validate_public(data: dict) -> None:
    if data.get("schemaVersion") != 1 or not isinstance(data.get("records"), list):
        raise ValueError("Invalid public ownership dataset schema")
    seen = set()
    for rec in data["records"]:
        if rec.get("approvalStatus") != "approved":
            raise ValueError("Public ownership records must be explicitly approved")
        if rec.get("classification") not in CLASSES - {"unknown"}:
            raise ValueError("Public records require an explicitly approved non-unknown classification")
        if not rec.get("businessId") or rec["businessId"] in seen:
            raise ValueError("Each public record must have a unique businessId")
        seen.add(rec["businessId"])
        if not rec.get("verifiedAt") or not rec.get("approvedAt") or not rec.get("approvedBy"):
            raise ValueError("Approval and verification metadata are required")
        if not rec.get("evidence") or any(not e.get("url", "").startswith("https://") for e in rec["evidence"]):
            raise ValueError("At least one HTTPS evidence URL is required")
        if any(e.get("fictional") for e in rec["evidence"]):
            raise ValueError("Fictional evidence cannot enter the public dataset")


def require_approvable_queue(queue: dict) -> None:
    if queue.get("registryDataStatus") != "real_research":
        raise ValueError("Approval is disabled for queues generated from fictional demo registries")


def approve_research_case(case_queue: dict, case_id: str, business_ids: list[str], approved_by: str,
                          verified_at: str, public: dict, registry: dict) -> tuple[dict, dict, dict]:
    """Apply an explicitly reviewed, source-backed case; candidates never publish themselves."""
    case = next((item for item in case_queue.get("researchCases", []) if item.get("caseId") == case_id), None)
    if not case or case.get("reviewStatus") != "ready_for_human_approval":
        raise ValueError("Research case is not marked ready for human approval")
    if case.get("candidateType") != "documented_acquisition_and_pe_platform_relationship":
        raise ValueError("This case documents no approvable ownership classification")
    if case.get("proposedClassification") not in CLASSES - {"unknown"}:
        raise ValueError("Research case has no explicit proposed classification")
    if not approved_by.strip():
        raise ValueError("Reviewer name is required")
    if date.fromisoformat(verified_at) > date.today():
        raise ValueError("Verification date cannot be in the future")
    if not business_ids or len(business_ids) != len(set(business_ids)):
        raise ValueError("Choose one or more unique business IDs")
    allowed = {link["businessId"] for link in case.get("identityLinks", [])
               if link.get("status") == "strong_source_location_match"}
    if not set(business_ids) <= allowed:
        raise ValueError("One or more business IDs lack a source-supported identity match")
    if any(record.get("businessId") in business_ids for record in public.get("records", [])):
        raise ValueError("A selected business ID already has a public ownership record")
    sources = case.get("evidence", [])
    if not sources or any(not source.get("url", "").startswith("https://") for source in sources):
        raise ValueError("Case requires HTTPS evidence sources")

    registry_next = json.loads(json.dumps(registry))
    entities = registry_next.setdefault("entities", [])
    entity_ids = {entity["id"] for entity in entities}
    for entity in case.get("registryEntities", []):
        if entity["id"] not in entity_ids:
            entities.append(entity)
            entity_ids.add(entity["id"])
    target_entity_id = case["registryEntities"][0]["id"]
    target_entity = next(entity for entity in entities if entity["id"] == target_entity_id)
    target_entity["overtureBusinessIds"] = list(dict.fromkeys(
        [*target_entity.get("overtureBusinessIds", []), *business_ids]))
    relationships = registry_next.setdefault("relationships", [])
    relationship_ids = {relationship["id"] for relationship in relationships}
    for candidate in case.get("registryRelationships", []):
        if candidate["id"] not in relationship_ids:
            rel = json.loads(json.dumps(candidate))
            rel["verifiedAt"] = verified_at
            for evidence in rel.get("evidence", []):
                evidence["verifiedAt"] = verified_at
            relationships.append(rel)
            relationship_ids.add(rel["id"])

    public_next = json.loads(json.dumps(public))
    for business_id in business_ids:
        public_next["records"].append({
            "businessId": business_id,
            "entityId": target_entity_id,
            "classification": case["proposedClassification"],
            "approvalStatus": "approved",
            "verifiedAt": verified_at,
            "approvedAt": date.today().isoformat(),
            "approvedBy": approved_by.strip(),
            "matchReasons": ["human_reviewed_research_case", "source_supported_business_identity"],
            "evidence": [{"url": source["url"], "description": source["supports"]}
                         for source in sources],
        })
    validate_public(public_next)
    case["reviewStatus"] = "approved"
    case["approvedBusinessIds"] = business_ids
    case["approvedAt"] = date.today().isoformat()
    case["approvedBy"] = approved_by.strip()
    case["verifiedAt"] = verified_at
    return case_queue, public_next, registry_next


AUTO_RELATIONSHIPS = {
    "acquired_by", "majority_investment_by", "portfolio_company_of",
    "formed_through_partnership", "subsidiary_of", "owned_by", "franchisee_of",
    "brand_affiliated_with",
}


def iso_date(value: str | None) -> bool:
    if not value:
        return False
    try:
        date.fromisoformat(value)
        return True
    except ValueError:
        return False


def fingerprint(value: object) -> str:
    encoded = json.dumps(value, sort_keys=True, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def evaluate_auto_case(case: dict, listings: dict, public: dict, registry: dict,
                       as_of: str | None = None) -> dict:
    """Pure evidence gate; identity and ownership proof are checked independently."""
    today = as_of or date.today().isoformat()
    businesses = {business["id"]: business for business in listings.get("businesses", [])}
    approved_by_id = {record["businessId"]: record for record in public.get("records", [])}
    blockers: list[str] = []
    business_ids = case.get("businessIds", [])
    if not business_ids or len(set(business_ids)) != len(business_ids):
        blockers.append("No unique Overture business IDs are selected")
    classification = case.get("proposedClassification")
    if classification not in CLASSES - {"unknown"}:
        blockers.append("No explicit non-Unknown ownership classification is proposed")
    if case.get("reviewStatus") not in {"ready_for_automatic_approval", "ready_for_human_approval",
                                         "research_complete", "approved", "auto_approved"}:
        blockers.append("Research case is not marked complete for publication review")
    if case.get("contradictions"):
        blockers.append("Research case has unresolved contradictory source findings")

    sources = case.get("evidence", [])
    source_urls = {source.get("url") for source in sources}
    if not sources:
        blockers.append("No source evidence is attached")
    for source in sources:
        if not source.get("url", "").startswith("https://") or not source.get("publisher") or not source.get("supports"):
            blockers.append("Every evidence item needs an HTTPS URL, publisher, and supported claim")
            break
        if not iso_date(source.get("verifiedAt")) or source["verifiedAt"] > today:
            blockers.append("Evidence verification date is missing or in the future")
            break
        if source.get("publishedAt") and (not iso_date(source["publishedAt"]) or source["publishedAt"] > today):
            blockers.append("An evidence publication date is invalid or in the future")
            break

    identity_links = {link.get("businessId"): link for link in case.get("identityLinks", [])}
    for business_id in business_ids:
        business = businesses.get(business_id)
        link = identity_links.get(business_id)
        if not business:
            blockers.append(f"Business ID {business_id} is not present in the Overture listings")
            continue
        if not link or link.get("identityVerified") is not True:
            blockers.append(f"Business identity is not verified for {business_id}")
            continue
        if (norm(link.get("address")) != norm(business.get("address"))
                or norm(link.get("city")) != norm(business.get("city"))):
            blockers.append(f"Verified address/city does not match Overture record {business_id}")
        if not iso_date(link.get("verifiedAt")) or link["verifiedAt"] > today:
            blockers.append(f"Identity verification date is invalid for {business_id}")
        evidence_urls = link.get("identityEvidenceUrls", [])
        if not evidence_urls or any(url not in source_urls for url in evidence_urls):
            blockers.append(f"Identity evidence is missing or not attached to the case for {business_id}")

    entities = {entity["id"]: entity for entity in [*registry.get("entities", []), *case.get("registryEntities", [])]}
    candidate_relationships = case.get("registryRelationships", [])
    graph: dict[str, list[str]] = defaultdict(list)
    controlling_owners: dict[str, set[str]] = defaultdict(set)
    for relationship in candidate_relationships:
        if relationship.get("type") not in AUTO_RELATIONSHIPS:
            blockers.append(f"Unsupported or ambiguous relationship type: {relationship.get('type')}")
            continue
        if relationship.get("fromEntityId") not in entities or relationship.get("toEntityId") not in entities:
            blockers.append("Ownership relationship references an undefined entity")
            continue
        rel_sources = {item.get("url") for item in relationship.get("evidence", [])}
        if not rel_sources or not rel_sources <= source_urls:
            blockers.append("Every ownership relationship must cite evidence attached to the case")
        if relationship.get("effectiveAt"):
            effective_urls = set(relationship.get("effectiveDateEvidenceUrls", []))
            if (not iso_date(relationship["effectiveAt"]) or not effective_urls
                    or not effective_urls <= source_urls):
                blockers.append("A closing/effective date needs explicit supporting source evidence")
        if relationship.get("announcedAt") and not iso_date(relationship["announcedAt"]):
            blockers.append("An announcement date is invalid")
        relationship_sources = {item.get("url"): item for item in relationship.get("evidence", [])}
        dated_sources = {source.get("publishedAt") for source in sources
                         if source.get("url") in relationship_sources and source.get("publishedAt")}
        if relationship.get("announcedAt") and dated_sources and relationship["announcedAt"] not in dated_sources:
            blockers.append("Announcement date conflicts with the publication date of its cited source")
        if relationship.get("type") == "acquired_by":
            if not relationship.get("effectiveAt") and not relationship.get("announcedAt"):
                blockers.append("Acquisition has neither a documented announcement nor closing date")
            if relationship.get("transactionType") == "carveout" and not relationship.get("scope"):
                blockers.append("Carve-out acquisition is missing its acquired/retained business scope")
        graph[relationship["fromEntityId"]].append(relationship["toEntityId"])
        if relationship.get("type") in {"acquired_by", "subsidiary_of", "owned_by"}:
            controlling_owners[relationship["fromEntityId"]].add(relationship["toEntityId"])

    if any(len(owners) > 1 for owners in controlling_owners.values()):
        blockers.append("Conflicting controlling-parent relationships are recorded")

    if not candidate_relationships and classification != "independent":
        blockers.append("Ownership relationships are incomplete")
    if classification == "private_equity_backed":
        root_id = case.get("registryEntities", [{}])[0].get("id") if case.get("registryEntities") else None
        reachable = set()
        frontier = [root_id] if root_id else []
        while frontier:
            current = frontier.pop()
            if current in reachable:
                continue
            reachable.add(current)
            frontier.extend(graph.get(current, []))
        if not any(entity_id in reachable and entity.get("type") == "pe_investor"
                   for entity_id, entity in entities.items()):
            blockers.append("No evidence-linked path reaches a verified PE investor")
    elif classification == "independent":
        positive = case.get("positiveIndependenceEvidence", [])
        if not positive or any(item.get("url") not in source_urls or not item.get("supportsCurrentOwnership") for item in positive):
            blockers.append("Independence requires positive current ownership evidence; absence of PE evidence is insufficient")
    elif classification == "subsidiary":
        if not any(rel.get("type") in {"subsidiary_of", "owned_by"} for rel in candidate_relationships):
            blockers.append("Documented corporate parent relationship is missing")
    elif classification == "public_company":
        root_id = case.get("registryEntities", [{}])[0].get("id") if case.get("registryEntities") else None
        reachable = set()
        frontier = [root_id] if root_id else []
        while frontier:
            current = frontier.pop()
            if current in reachable:
                continue
            reachable.add(current)
            frontier.extend(graph.get(current, []))
        if not any(entity_id in reachable and entity.get("type") == "public_company"
                   for entity_id, entity in entities.items()):
            blockers.append("No evidence-linked path reaches a verified public parent company")

    case_type = case.get("candidateType", "")
    documented_relationship = case.get("documentedRelationship", {})
    if documented_relationship.get("ultimateOwnership") in {"not established", "unresolved", None} \
            and case_type == "documented_business_affiliation_ownership_unresolved":
        blockers.append("Ultimate ownership is unresolved")
    if "franchise" in case_type:
        local_operator = case.get("localOperator", {})
        if not local_operator.get("identity") or local_operator.get("status") != "verified":
            blockers.append("Franchise brand affiliation does not identify the local legal operator")
    if case.get("reviewStatus") in {"ownership_unresolved", "franchise_network_documented_operator_unresolved"}:
        blockers.append("Case is explicitly marked unresolved")

    existing = [approved_by_id.get(business_id) for business_id in business_ids]
    conflicts = [record for record in existing if record and (
        record.get("entityId") != (case.get("registryEntities", [{}])[0].get("id") if case.get("registryEntities") else None)
        or record.get("classification") != classification
        or record.get("approvalStatus") != "approved")]
    if conflicts:
        blockers.append("An existing public classification conflicts with this candidate")
    if blockers:
        status = "blocked"
    elif all(existing):
        status = "already_published"
    else:
        status = "eligible"
    fingerprints = {business_id: fingerprint({"case": case, "business": businesses.get(business_id)})
                    for business_id in business_ids}
    return {"caseId": case.get("caseId"), "title": case.get("title"), "status": status,
            "businessIds": business_ids, "classification": classification, "blockers": list(dict.fromkeys(blockers)),
            "unselectedIdentityLinks": [link for link in case.get("identityLinks", [])
                                         if link.get("businessId") not in business_ids],
            "fingerprints": fingerprints,
            "evidenceFingerprints": {source["url"]: fingerprint(source) for source in sources if source.get("url")},
            "evidenceUrls": sorted(url for url in source_urls if url)}


def dry_run_auto_publication(listings: dict, public: dict, registry: dict, cases: list[dict],
                             as_of: str | None = None) -> dict:
    outcomes = [evaluate_auto_case(case, listings, public, registry, as_of) for case in cases]
    return {"schemaVersion": 1, "mode": "dry_run", "generatedAt": as_of or date.today().isoformat(),
            "proposedPublications": [outcome for outcome in outcomes if outcome["status"] == "eligible"],
            "alreadyPublished": [outcome for outcome in outcomes if outcome["status"] == "already_published"],
            "blocked": [outcome for outcome in outcomes if outcome["status"] == "blocked"]}


def publish_auto_eligible(listings: dict, public: dict, registry: dict, queue: dict, cases: list[dict],
                          cache: dict | None = None, as_of: str | None = None) -> tuple[dict, dict, dict, dict, dict | None]:
    plan = dry_run_auto_publication(listings, public, registry, cases, as_of)
    if not plan["proposedPublications"]:
        return public, registry, queue, plan, None
    now = datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")
    snapshot_id = now.replace(":", "").replace("-", "") + "-" + fingerprint(plan["proposedPublications"])[:10]
    public_next = json.loads(json.dumps(public))
    registry_next = json.loads(json.dumps(registry))
    queue_next = json.loads(json.dumps(queue))
    snapshot = {"schemaVersion": 1, "snapshotId": snapshot_id, "createdAt": now, "status": "applied",
                "caseIds": [], "businessIds": [], "publicRecordsBefore": {}, "registryEntitiesAdded": [],
                "registryRelationshipsAdded": [], "entityBusinessIdsBefore": {}, "caseFieldsBefore": {}}
    all_entities = {entity["id"] for entity in registry_next.get("entities", [])}
    all_relationships = {relation["id"] for relation in registry_next.get("relationships", [])}
    cases_by_id = {case["caseId"]: case for case in queue_next.get("researchCases", [])}
    source_cases = {case["caseId"]: case for case in cases}
    for outcome in plan["proposedPublications"]:
        case = source_cases[outcome["caseId"]]
        target_id = case["registryEntities"][0]["id"]
        snapshot["caseIds"].append(case["caseId"])
        snapshot["businessIds"].extend(outcome["businessIds"])
        for business_id in outcome["businessIds"]:
            snapshot["publicRecordsBefore"][business_id] = next(
                (record for record in public_next["records"] if record["businessId"] == business_id), None)
        for entity in case.get("registryEntities", []):
            if entity["id"] not in all_entities:
                registry_next.setdefault("entities", []).append({**entity, "publicationId": snapshot_id})
                all_entities.add(entity["id"])
                snapshot["registryEntitiesAdded"].append(entity["id"])
        target = next(entity for entity in registry_next["entities"] if entity["id"] == target_id)
        snapshot["entityBusinessIdsBefore"][target_id] = list(target.get("overtureBusinessIds", []))
        target["overtureBusinessIds"] = list(dict.fromkeys([*target.get("overtureBusinessIds", []), *outcome["businessIds"]]))
        for relationship in case.get("registryRelationships", []):
            if relationship["id"] not in all_relationships:
                rel = json.loads(json.dumps(relationship))
                rel["verifiedAt"] = as_of or date.today().isoformat()
                for evidence in rel.get("evidence", []):
                    evidence["verifiedAt"] = rel["verifiedAt"]
                rel["publicationId"] = snapshot_id
                registry_next.setdefault("relationships", []).append(rel)
                all_relationships.add(rel["id"])
                snapshot["registryRelationshipsAdded"].append(rel["id"])
        review_case = cases_by_id.get(case["caseId"])
        if review_case is not None:
            snapshot["caseFieldsBefore"][case["caseId"]] = {key: review_case.get(key) for key in
                ("reviewStatus", "autoApprovedAt", "approvedBusinessIds", "publicationId")}
            review_case.update({"reviewStatus": "auto_approved", "autoApprovedAt": as_of or date.today().isoformat(),
                                "approvedBusinessIds": outcome["businessIds"], "publicationId": snapshot_id,
                                "approvalMethod": "automated_evidence_gate"})
        for business_id in outcome["businessIds"]:
            public_next["records"].append({
                "businessId": business_id, "entityId": target_id,
                "classification": case["proposedClassification"], "approvalStatus": "approved",
                "approvalMethod": "automated_evidence_gate", "publicationId": snapshot_id,
                "verifiedAt": as_of or date.today().isoformat(), "approvedAt": as_of or date.today().isoformat(),
                "approvedBy": "Evidence-gated automation",
                "matchReasons": ["case_identity_verified", "source_evidence_complete", "ownership_relationships_complete"],
                "evidence": [{"url": source["url"], "description": source["supports"]} for source in case["evidence"]],
            })
    validate_public(public_next)
    cache_next = update_automation_cache(cache or {}, plan, as_of or date.today().isoformat())
    return public_next, registry_next, queue_next, plan, {**snapshot, "cache": cache_next}


def update_automation_cache(cache: dict, plan: dict, evaluated_at: str) -> dict:
    updated = json.loads(json.dumps(cache))
    updated.setdefault("schemaVersion", 1)
    entries = updated.setdefault("caseFingerprints", {})
    evidence_cache = updated.setdefault("evidence", {})
    outcomes = [*plan["proposedPublications"], *plan["alreadyPublished"], *plan["blocked"]]
    evidence_by_url: dict[str, dict[str, set[str]]] = defaultdict(lambda: defaultdict(set))
    for outcome in outcomes:
        prior = entries.get(outcome["caseId"], {})
        unchanged = prior.get("fingerprints") == outcome["fingerprints"]
        entries[outcome["caseId"]] = {"fingerprints": outcome["fingerprints"],
            "lastDecision": outcome["status"], "lastEvaluatedAt": prior.get("lastEvaluatedAt", evaluated_at) if unchanged else evaluated_at,
            "unchangedRuns": prior.get("unchangedRuns", 0) + 1 if unchanged else 0,
            "evidenceUrls": outcome["evidenceUrls"]}
        for url, evidence_fingerprint in outcome.get("evidenceFingerprints", {}).items():
            evidence_by_url[url][evidence_fingerprint].add(outcome["caseId"])
    # A shared source can support several cases. Count one verification pass per URL,
    # while fingerprinting every distinct claim recorded against that URL.
    for url, claims in evidence_by_url.items():
        aggregate_fingerprint = fingerprint(sorted(claims))
        previous = evidence_cache.get(url, {})
        same_evidence = previous.get("fingerprint") == aggregate_fingerprint
        case_ids = set(previous.get("caseIds", []))
        for case_ids_for_claim in claims.values():
            case_ids.update(case_ids_for_claim)
        evidence_cache[url] = {"fingerprint": aggregate_fingerprint, "caseIds": sorted(case_ids),
            "lastEvaluatedAt": previous.get("lastEvaluatedAt", evaluated_at) if same_evidence else evaluated_at,
            "unchangedRuns": previous.get("unchangedRuns", 0) + 1 if same_evidence else 0}
    return updated


def rollback_auto_publication(snapshot: dict, public: dict, registry: dict, queue: dict,
                              rolled_back_at: str | None = None) -> tuple[dict, dict, dict, dict]:
    if snapshot.get("status") != "applied":
        raise ValueError("Snapshot is not an active publication or was already rolled back")
    snapshot_id = snapshot["snapshotId"]
    public_next = json.loads(json.dumps(public))
    registry_next = json.loads(json.dumps(registry))
    queue_next = json.loads(json.dumps(queue))
    new_public = [record for record in public_next.get("records", []) if record.get("publicationId") != snapshot_id]
    for business_id, previous in snapshot.get("publicRecordsBefore", {}).items():
        if previous is not None:
            if not any(record.get("businessId") == business_id for record in new_public):
                new_public.append(previous)
    public_next["records"] = new_public
    remove_relations = set(snapshot.get("registryRelationshipsAdded", []))
    registry_next["relationships"] = [relation for relation in registry_next.get("relationships", [])
                                      if relation.get("id") not in remove_relations]
    prior_business_ids = snapshot.get("entityBusinessIdsBefore", {})
    for entity in registry_next.get("entities", []):
        if entity["id"] in prior_business_ids:
            entity["overtureBusinessIds"] = prior_business_ids[entity["id"]]
    referenced_entities = {record.get("entityId") for record in public_next.get("records", [])}
    for relationship in registry_next.get("relationships", []):
        referenced_entities.update((relationship.get("fromEntityId"), relationship.get("toEntityId")))
    remove_entities = set(snapshot.get("registryEntitiesAdded", [])) - referenced_entities
    registry_next["entities"] = [entity for entity in registry_next.get("entities", [])
                                 if entity.get("id") not in remove_entities]
    cases = {case["caseId"]: case for case in queue_next.get("researchCases", [])}
    for case_id, old_fields in snapshot.get("caseFieldsBefore", {}).items():
        case = cases.get(case_id)
        if case:
            for key, value in old_fields.items():
                if value is None:
                    case.pop(key, None)
                else:
                    case[key] = value
            case.pop("approvalMethod", None)
    snapshot_next = json.loads(json.dumps(snapshot))
    snapshot_next["status"] = "rolled_back"
    snapshot_next["rolledBackAt"] = rolled_back_at or date.today().isoformat()
    validate_public(public_next)
    return public_next, registry_next, queue_next, snapshot_next


def write_json_atomic(path: Path, value: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(path.name + ".tmp")
    temporary.write_text(json.dumps(value, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    temporary.replace(path)


def automation_inputs():
    config = load(AUTOMATION_CONFIG)
    if not config.get("evidenceGatedAutoPublication"):
        raise ValueError("Evidence-gated auto-publication is disabled in the automation config")
    if config.get("optionalResearch", {}).get("enabled") or config.get("optionalResearch", {}).get("maxSpendUsdPerRun", 0) != 0:
        raise ValueError("This sprint's auto workflow does not permit external research spending")
    listings = load_all_overture_listings()
    public = load(PUBLIC)
    registry = load_registry(DEFAULT_REGISTRY)
    queue = load(QUEUE)
    cases = queue.get("researchCases", [])
    validate_public(public)
    return listings, public, registry, queue, cases


def render_auto_plan(plan: dict) -> str:
    lines = [f"Mode: {plan['mode']}", f"Proposed publications: {len(plan['proposedPublications'])}",
             f"Already published: {len(plan['alreadyPublished'])}", f"Blocked: {len(plan['blocked'])}"]
    for outcome in plan["proposedPublications"]:
        cache = " (unchanged evidence cached)" if outcome.get("cacheHit") else ""
        lines.append(f"ELIGIBLE {outcome['caseId']} -> {', '.join(outcome['businessIds'])} ({outcome['classification']}){cache}")
    for outcome in plan["alreadyPublished"]:
        cache = " (unchanged evidence cached)" if outcome.get("cacheHit") else ""
        lines.append(f"CURRENT {outcome['caseId']} -> {', '.join(outcome['businessIds'])} (already approved){cache}")
        for link in outcome["unselectedIdentityLinks"]:
            lines.append(f"  IDENTITY NOT SELECTED {link['businessId']}: {link.get('reason', 'identity not verified')}")
    for outcome in plan["blocked"]:
        cache = " (unchanged evidence cached)" if outcome.get("cacheHit") else ""
        lines.append(f"BLOCKED {outcome['caseId']} -> {', '.join(outcome['businessIds'])}: {'; '.join(outcome['blockers'])}{cache}")
        for link in outcome["unselectedIdentityLinks"]:
            lines.append(f"  IDENTITY NOT SELECTED {link['businessId']}: {link.get('reason', 'identity not verified')}")
    return "\n".join(lines)


def cmd_auto_dry_run(args):
    listings, public, registry, _queue, cases = automation_inputs()
    plan = dry_run_auto_publication(listings, public, registry, cases, args.as_of)
    cache = load(AUTOMATION_CACHE) if AUTOMATION_CACHE.exists() else {}
    for outcome in [*plan["proposedPublications"], *plan["alreadyPublished"], *plan["blocked"]]:
        prior = cache.get("caseFingerprints", {}).get(outcome["caseId"], {})
        outcome["cacheHit"] = prior.get("fingerprints") == outcome["fingerprints"]
    print(render_auto_plan(plan))
    print("Dry run only: public ownership, registry, queue, cache, and snapshots were not modified.")


def cmd_auto_publish(args):
    listings, public, registry, queue, cases = automation_inputs()
    cache = load(AUTOMATION_CACHE) if AUTOMATION_CACHE.exists() else {}
    public_next, registry_next, queue_next, plan, snapshot = publish_auto_eligible(
        listings, public, registry, queue, cases, cache, args.as_of)
    cache_next = update_automation_cache(cache, plan, args.as_of or date.today().isoformat())
    if snapshot is None:
        write_json_atomic(AUTOMATION_CACHE, cache_next)
        print(render_auto_plan({**plan, "mode": "auto_publish"}))
        print("No public ownership changes; cache updated. No snapshot was needed.")
        return
    snapshot.pop("cache", None)
    snapshot_path = OWNERSHIP_SNAPSHOTS / f"{snapshot['snapshotId']}.json"
    write_json_atomic(snapshot_path, snapshot)
    validate_public(public_next)
    write_json_atomic(PUBLIC, public_next)
    write_json_atomic(DEFAULT_REGISTRY, registry_next)
    write_json_atomic(QUEUE, queue_next)
    write_json_atomic(AUTOMATION_CACHE, cache_next)
    print(render_auto_plan({**plan, "mode": "auto_publish"}))
    print(f"Published {len(plan['proposedPublications'])} finding(s). Rollback snapshot: {snapshot['snapshotId']}")


def cmd_rollback(args):
    snapshot_path = OWNERSHIP_SNAPSHOTS / f"{args.snapshot_id}.json"
    snapshot = load(snapshot_path)
    public_next, registry_next, queue_next, snapshot_next = rollback_auto_publication(
        snapshot, load(PUBLIC), load_registry(DEFAULT_REGISTRY), load(QUEUE))
    validate_public(public_next)
    write_json_atomic(PUBLIC, public_next)
    write_json_atomic(DEFAULT_REGISTRY, registry_next)
    write_json_atomic(QUEUE, queue_next)
    write_json_atomic(snapshot_path, snapshot_next)
    print(f"Rolled back publication {args.snapshot_id}; restored {len(snapshot.get('businessIds', []))} business record(s).")


def cmd_match(args):
    registry_path = args.registry.resolve()
    registry = load_registry(registry_path)
    queue = generate_queue(load(LISTINGS), registry)
    public = load(PUBLIC)
    approved_by_business = {record["businessId"]: record for record in public.get("records", [])
                            if record.get("approvalStatus") == "approved"}
    for entry in queue["entries"]:
        approved = approved_by_business.get(entry["businessId"])
        if approved and approved.get("entityId") in {candidate["entityId"] for candidate in entry["candidates"]}:
            entry["reviewStatus"] = "approved"
            entry["ownershipAssigned"] = True
    if QUEUE.exists():
        queue["researchCases"] = load(QUEUE).get("researchCases", [])
    queue["registryPath"] = str(registry_path)
    queue["registryDataStatus"] = registry["dataStatus"]
    QUEUE.write_text(json.dumps(queue, indent=2) + "\n", encoding="utf-8")
    print(f"Wrote {len(queue['entries'])} candidate businesses to {QUEUE.relative_to(ROOT)}")


def cmd_approve(args):
    queue = load(QUEUE)
    require_approvable_queue(queue)
    entry = next((e for e in queue["entries"] if e["businessId"] == args.business_id), None)
    if not entry:
        raise ValueError("Business ID is not in the current research queue")
    candidate = next((c for c in entry["candidates"] if c["entityId"] == args.entity_id), None)
    if not candidate:
        raise ValueError("Entity ID is not a candidate for this business")
    if args.classification not in CLASSES - {"unknown"}:
        raise ValueError("Choose an explicit non-unknown classification")
    if not args.evidence_url.startswith("https://") or ".invalid" in domain(args.evidence_url):
        raise ValueError("Provide a real HTTPS evidence URL; fictional placeholders are rejected")
    if date.fromisoformat(args.verified_at) > date.today():
        raise ValueError("Verification date cannot be in the future")
    public = load(PUBLIC)
    rec = {"businessId": args.business_id, "entityId": args.entity_id,
           "classification": args.classification, "approvalStatus": "approved", "verifiedAt": args.verified_at,
           "approvedAt": date.today().isoformat(), "approvedBy": args.approved_by,
           "matchConfidence": candidate["confidence"], "matchReasons": candidate["matchReasons"],
           "evidence": [{"url": args.evidence_url, "description": args.evidence_note}]}
    existing = next((i for i, r in enumerate(public["records"]) if r["businessId"] == args.business_id), None)
    if existing is None:
        public["records"].append(rec)
    else:
        public["records"][existing] = rec
    validate_public(public)
    PUBLIC.write_text(json.dumps(public, indent=2) + "\n", encoding="utf-8")
    entry["reviewStatus"] = "approved"
    entry["ownershipAssigned"] = True
    QUEUE.write_text(json.dumps(queue, indent=2) + "\n", encoding="utf-8")
    print(f"Approved {args.business_id} as {args.classification}")



# Discovery links are research leads only. They are deliberately separate from
# generate_queue()/approve and from the public classification dataset.
GENERIC_NAME_TOKENS = {
    "air", "airconditioning", "conditioning", "cooling", "heating", "hvac",
    "mechanical", "plumbing", "electrical", "services", "service", "company",
    "inc", "llc", "corp", "corporation", "co", "and", "the",
}
FREE_EMAIL_OR_HOSTS = {"gmail.com", "yahoo.com", "hotmail.com", "outlook.com", "icloud.com"}


def normalized_phone(value: str | None) -> str:
    digits = re.sub(r"\D", "", value or "")
    if len(digits) == 11 and digits.startswith("1"):
        digits = digits[1:]
    return digits if len(digits) >= 10 else ""


def address_key(value: str | None) -> str:
    return norm(value)


def name_similarity(left: str, right: str) -> float:
    a, b = norm(left), norm(right)
    seq = SequenceMatcher(None, a, b).ratio()
    at = {token for token in a.split() if token not in GENERIC_NAME_TOKENS and len(token) > 1}
    bt = {token for token in b.split() if token not in GENERIC_NAME_TOKENS and len(token) > 1}
    overlap = len(at & bt) / len(at | bt) if at and bt else 0.0
    if len(at & bt) < 2:
        return 0.0
    return max(seq, overlap)


def listing_signals(business: dict) -> dict[str, str]:
    host = domain(business.get("website"))
    if host in FREE_EMAIL_OR_HOSTS:
        host = ""
    return {
        "website_domain": host,
        "phone": normalized_phone(business.get("phone")),
        "address": address_key(business.get("address")),
    }


def discovery_query(business: dict, related_names: list[str]) -> list[str]:
    name = business.get("name", "").strip()
    city = business.get("city", "").strip()
    site = domain(business.get("website"))
    queries = [f'"{name}" "{city}" (acquisition OR acquired OR ownership OR investor)']
    if site:
        queries.append(f'site:{site} (parent OR owner OR acquisition OR acquired OR investor)')
    else:
        queries.append(f'"{name}" "{city}" HVAC owner OR company')
    if related_names:
        queries.append(f'"{name}" "{related_names[0]}" (acquisition OR parent company OR shared ownership)')
    queries.append(f'"{name}" "{city}" founder owner independent HVAC company')
    return list(dict.fromkeys(queries))


def generate_discovery_queue(listings: dict, registry: dict, public: dict, generated_at: str | None = None,
                             source_leads: dict | None = None, research_cases: dict | None = None) -> dict:
    businesses = listings.get("businesses", [])
    approved_ids = {record["businessId"] for record in public.get("records", [])
                    if record.get("approvalStatus") == "approved" and record.get("classification") != "unknown"}
    classified = [b for b in businesses if b["id"] in approved_ids]
    unclassified = [b for b in businesses if b["id"] not in approved_ids]
    signals = {b["id"]: listing_signals(b) for b in unclassified}
    edges: dict[tuple[str, str], list[dict]] = defaultdict(list)
    by_value: dict[tuple[str, str], list[str]] = defaultdict(list)
    for business in unclassified:
        for kind, value in signals[business["id"]].items():
            if value:
                by_value[(kind, value)].append(business["id"])
    businesses_by_id = {b["id"]: b for b in unclassified}
    for (kind, value), ids in by_value.items():
        if len(ids) < 2:
            continue
        ids = sorted(set(ids))
        for i, left in enumerate(ids):
            for right in ids[i + 1:]:
                edges[(left, right)].append({"signal": f"shared_{kind}", "value": value})
    # Name similarity is a weak, explainable lead and is never used as proof.
    for i, left in enumerate(unclassified):
        for right in unclassified[i + 1:]:
            similarity = name_similarity(left.get("name", ""), right.get("name", ""))
            if similarity >= 0.76:
                pair = tuple(sorted((left["id"], right["id"])))
                edges[pair].append({"signal": "similar_business_name", "similarity": round(similarity, 2)})
    # Connected components group leads; they explicitly do not merge listings.
    parent = {business["id"]: business["id"] for business in unclassified}
    def find(item: str) -> str:
        while parent[item] != item:
            parent[item] = parent[parent[item]]
            item = parent[item]
        return item
    def union(left: str, right: str) -> None:
        a, b = find(left), find(right)
        if a != b:
            parent[max(a, b)] = min(a, b)
    for left, right in edges:
        union(left, right)
    component_ids: dict[str, list[str]] = defaultdict(list)
    for business_id in parent:
        component_ids[find(business_id)].append(business_id)
    groups = {}
    for ids in component_ids.values():
        if len(ids) < 2:
            continue
        ids.sort()
        group_id = "lead-" + hashlib.sha256("|".join(ids).encode()).hexdigest()[:12]
        groups[group_id] = ids

    cases = (research_cases or {}).get("candidates", [])
    case_by_business: dict[str, list[dict]] = defaultdict(list)
    candidate_weights = {
        "documented_acquisition_and_pe_platform_relationship": (100, "documented acquisition and PE platform relationship; review candidate only"),
        "documented_business_affiliation_ownership_unresolved": (70, "primary source documents affiliation; legal ownership unresolved"),
        "franchise_brand_parent_relationship_only": (55, "documented franchise brand/network; local franchise ownership unresolved"),
    }
    for case in cases:
        for business_id in case.get("businessIds", []):
            case_by_business[business_id].append(case)
    entries = []
    for business in unclassified:
        business_id = business["id"]
        related: dict[str, list[dict]] = defaultdict(list)
        for (left, right), reasons in edges.items():
            if business_id == left:
                related[right].extend(reasons)
            elif business_id == right:
                related[left].extend(reasons)
        group_id = next((gid for gid, ids in groups.items() if business_id in ids), None)
        related_businesses = sorted(related)
        lead_signals = sorted({reason["signal"] for reasons in related.values() for reason in reasons})
        business_cases = case_by_business.get(business_id, [])
        candidate_priority = max((candidate_weights.get(case.get("candidateType"), (0, ""))[0]
                                   for case in business_cases), default=0)
        priority = candidate_priority
        ownership_priority_reasons = list(dict.fromkeys(
            f"{candidate_weights.get(case.get('candidateType'), (0, ''))[1]} — {case.get('title', case['caseId'])}"
            for case in business_cases))
        related_names = [businesses_by_id[other].get("name", "") for other in related_businesses]
        curated_leads = [lead for lead in (source_leads or {}).get("leads", [])
                         if business_id in lead.get("businessIds", [])]
        entries.append({
            "businessId": business_id,
            "businessName": business.get("name", ""),
            "city": business.get("city", ""),
            "address": business.get("address"),
            "website": business.get("website"),
            "phone": business.get("phone"),
            "priorityScore": priority,
            "priorityReasons": ownership_priority_reasons,
            "researchCaseIds": [case["caseId"] for case in business_cases],
            "researchGroupId": group_id,
            "relatedBusinessIds": related_businesses,
            "relatedBusinesses": [{"businessId": other, "businessName": businesses_by_id[other].get("name", ""),
                                   "signals": sorted({reason["signal"] for reason in reasons})}
                                  for other, reasons in sorted(related.items())],
            "identityCandidates": [],
            "suggestedSearchQueries": discovery_query(business, related_names),
            "reviewStatus": "unreviewed",
            "ownershipClassification": None,
            "ownershipEvidence": [],
            "evidenceStatus": "no_ownership_evidence_reviewed",
            "sourceResearchLeads": curated_leads,
            "signalsAreOwnershipEvidence": False,
        })
    entries.sort(key=lambda entry: (-entry["priorityScore"], entry["businessName"].casefold(), entry["businessId"]))
    group_summary = []
    for group_id, ids in sorted(groups.items()):
        group_entries = [entry for entry in entries if entry["businessId"] in ids]
        group_queries = []
        for entry in group_entries:
            group_queries.extend(entry["suggestedSearchQueries"])
        group_names = [businesses_by_id[item]["name"] for item in ids]
        group_queries.insert(0, f'"{group_names[0]}" "{group_names[-1]}" HVAC ownership acquisition')
        group_summary.append({"groupId": group_id, "businessIds": ids,
                              "businessNames": [businesses_by_id[item]["name"] for item in ids],
                              "city": ", ".join(sorted({businesses_by_id[item].get("city", "") for item in ids})),
                              "priorityScore": max(entry["priorityScore"] for entry in group_entries),
                              "suggestedSearchQueries": list(dict.fromkeys(group_queries)),
                              "signals": sorted({signal for entry in group_entries for signal in
                                                 [signal for other in entry["relatedBusinesses"] for signal in other.get("signals", [])]}),
                              "ownershipConclusion": None, "reviewStatus": "unreviewed"})
    return {
        "schemaVersion": 1,
        "generatedAt": generated_at or date.today().isoformat(),
        "source": "Overture Maps HVAC listings plus public-record prioritization leads",
        "dataStatus": "discovery_leads_only",
        "safeguard": "Shared identifiers and name similarity are only duplicate/related-listing signals and do not affect ownership-research priority or establish identity, ownership, parentage, acquisition, independence, or classification.",
        "totalHvacListings": len(businesses),
        "classifiedListings": len(classified),
        "unclassifiedListings": len(unclassified),
        "researchReadyListings": len(entries),
        "groupsAreMerges": False,
        "groups": group_summary,
        "relatedListingGroups": group_summary,
        "researchCases": cases,
        "entries": entries,
    }


def render_discovery_report(queue: dict, limit: int = 20) -> str:
    lines = ["# HVAC Ownership Discovery — Top Research Candidates", "",
             f"Generated {queue['generatedAt']}. These are research leads, not ownership findings.", "",
             "Ownership research priority comes from documented acquisition, corporate, or franchise-network leads. Shared names, domains, phones, and addresses are tracked separately as duplicate/related-listing signals and are not ownership evidence.", "",
             f"- HVAC listings: {queue['totalHvacListings']}",
             f"- Classified with approved public records: {queue['classifiedListings']}",
             f"- Unclassified: {queue['unclassifiedListings']}",
             f"- Research-ready: {queue['researchReadyListings']}",
             f"- Related-listing lead groups (not merged): {len(queue['groups'])}", "",
             "## Highest-priority research targets", "",
             "Related Overture records are grouped into one research task; grouping is not a business merge or ownership conclusion.", "",
             "| # | Research target | City | Ownership research priority | Listing IDs | Source and review status |", "|---:|---|---|---|---|---|"]
    entries_by_id = {entry["businessId"]: entry for entry in queue["entries"]}
    raw_cases = queue.get("researchCases", [])
    if isinstance(raw_cases, dict):
        raw_cases = raw_cases.get("candidates", [])
    cases_by_id = {case["caseId"]: case for case in raw_cases}
    tasks = []
    grouped_ids = set()
    for group in queue["groups"]:
        ids = group["businessIds"]
        grouped_ids.update(ids)
        members = [entries_by_id[item] for item in ids]
        reasons = sorted({reason for member in members for reason in member["priorityReasons"]})
        unique_names = list(dict.fromkeys(group["businessNames"]))
        group_name = " / ".join(unique_names)
        if len(unique_names) == 1 and len(ids) > 1:
            group_name += f" ({len(ids)} related listings)"
        tasks.append({"name": group_name, "city": group["city"],
                      "score": group["priorityScore"], "reasons": reasons, "ids": ids,
                      "leads": [lead for member in members for lead in member.get("sourceResearchLeads", [])],
                      "caseIds": sorted({case_id for member in members for case_id in member.get("researchCaseIds", [])})})
    for entry in queue["entries"]:
        if entry["businessId"] in grouped_ids:
            continue
        tasks.append({"name": entry["businessName"], "city": entry["city"], "score": entry["priorityScore"],
                      "reasons": entry["priorityReasons"], "ids": [entry["businessId"]],
                      "leads": entry.get("sourceResearchLeads", []), "caseIds": entry.get("researchCaseIds", [])})
    tasks.sort(key=lambda task: (-task["score"], task["name"].casefold(), task["ids"][0]))
    for rank, task in enumerate(tasks[:limit], 1):
        reasons = "; ".join(task["reasons"]) or "No documented ownership lead; routine coverage"
        ids = ", ".join(f"`{item}`" for item in task["ids"])
        task_cases = [cases_by_id[case_id] for case_id in task["caseIds"] if case_id in cases_by_id]
        if task_cases:
            case_status = []
            for case in task_cases:
                unresolved = [link["businessId"] for link in case.get("identityLinks", [])
                              if link.get("status") != "strong_source_location_match"]
                row = (f"{case['title']} — `{case['reviewStatus']}` — applies to "
                       f"`{', '.join(case.get('businessIds', []))}`")
                if unresolved:
                    row += f"; unresolved identity: `{', '.join(unresolved)}`"
                row += " " + " ".join(
                    f"[{index + 1}]({source['url']})" for index, source in enumerate(case.get("evidence", [])))
                case_status.append(row)
            status = "<br>".join(case_status)
        elif task["leads"]:
            unique_leads = {lead["url"]: lead for lead in task["leads"]}
            status = "Unverified source leads: " + " ".join(
                f"[{lead['label']}]({lead['url']}) — {lead['note']}" for lead in unique_leads.values())
        else:
            status = "No ownership evidence reviewed; unverified"
        lines.append(f"| {rank} | {task['name']} | {task['city']} | {reasons} | {ids} | {status} |")
    lines += ["", "## Next research steps", "",
              "Start with the suggested queries in `data/hvacOwnershipDiscoveryQueue.json`. Check company and investor sites, acquisition announcements, Secretary of State/company filings, and other primary documents. Record source URLs and exact announcement/closing dates in the research registry. Treat any discovered independence claim as a separate positive-evidence question; absence of PE results is not evidence of independence.", "",
              "To regenerate without changing approved classifications:", "",
              "```sh", "python3 scripts/ownership_research.py discover", "python3 -m unittest tests/test_ownership_research.py", "```", "",
              "The discovery command only rewrites the discovery queue and this report. Use the existing `match` command for registry identity candidates and the separate `approve` command for manual publication after review.", ""]
    return "\n".join(lines)


def cmd_discover(args):
    listings = load(LISTINGS)
    registry = load_registry(DEFAULT_REGISTRY)
    public = load(PUBLIC)
    validate_public(public)
    source_leads = load(SOURCE_LEADS) if SOURCE_LEADS.exists() else None
    review_cases = load(QUEUE).get("researchCases", [])
    cases = {"candidates": review_cases or load(RESEARCH_CASES).get("candidates", [])}
    queue = generate_discovery_queue(listings, registry, public, args.as_of, source_leads, cases)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.report.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(queue, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    args.report.write_text(render_discovery_report(queue, args.top), encoding="utf-8")
    print(f"HVAC listings: {queue['totalHvacListings']}; classified: {queue['classifiedListings']}; unclassified/research-ready: {queue['researchReadyListings']}")
    print(f"Related-listing lead groups (not merged): {len(queue['groups'])}")
    print(f"Wrote {args.output.relative_to(ROOT)} and {args.report.relative_to(ROOT)}")


def cmd_stage_cases(_args):
    queue = load(QUEUE)
    cases = load(RESEARCH_CASES)
    listing_ids = {business["id"] for business in load_all_overture_listings().get("businesses", [])}
    for case in cases.get("candidates", []):
        referenced = set(case.get("businessIds", []))
        referenced.update(link.get("businessId") for link in case.get("identityLinks", []))
        if not referenced <= listing_ids:
            raise ValueError(f"Research case {case.get('caseId')} references an unknown Overture business ID")
    existing = {case["caseId"]: case for case in queue.get("researchCases", [])}
    staged = []
    for candidate in cases["candidates"]:
        prior = existing.get(candidate["caseId"], {})
        merged = {**candidate}
        if prior.get("reviewStatus") == "approved":
            for key in ("reviewStatus", "approvedBusinessIds", "approvedAt", "approvedBy", "verifiedAt"):
                if key in prior:
                    merged[key] = prior[key]
        staged.append(merged)
    queue["researchCases"] = staged
    QUEUE.write_text(json.dumps(queue, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"Staged {len(cases['candidates'])} source-backed cases in {QUEUE.relative_to(ROOT)}; public classifications unchanged")


def cmd_approve_case(args):
    queue = load(QUEUE)
    public = load(PUBLIC)
    registry = load_registry(DEFAULT_REGISTRY)
    validate_public(public)
    queue_next, public_next, registry_next = approve_research_case(
        queue, args.case_id, args.business_id, args.approved_by, args.verified_at, public, registry)
    QUEUE.write_text(json.dumps(queue_next, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    PUBLIC.write_text(json.dumps(public_next, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    DEFAULT_REGISTRY.write_text(json.dumps(registry_next, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"Approved {args.case_id} for {len(args.business_id)} Overture record(s); registry and public ownership updated")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(required=True)
    match = sub.add_parser("match", help="Generate candidate queue from current Overture listings")
    match.add_argument("--registry", type=Path, default=DEFAULT_REGISTRY,
                       help="Registry JSON path (default: real research registry; demo registry queues cannot be approved)")
    match.set_defaults(func=cmd_match)
    discover = sub.add_parser("discover", help="Build a separate prioritized queue for unclassified HVAC ownership research")
    discover.add_argument("--output", type=Path, default=DISCOVERY_QUEUE)
    discover.add_argument("--report", type=Path, default=DISCOVERY_REPORT)
    discover.add_argument("--top", type=int, default=20)
    discover.add_argument("--as-of", help="Set generated date (YYYY-MM-DD), mainly for reproducible runs")
    discover.set_defaults(func=cmd_discover)
    stage = sub.add_parser("stage-cases", help="Stage reviewed source candidates in the existing manual review queue")
    stage.set_defaults(func=cmd_stage_cases)
    approve_case = sub.add_parser("approve-case", help="Manually approve an eligible multi-record source-backed case")
    approve_case.add_argument("case_id")
    approve_case.add_argument("--business-id", action="append", required=True,
                              help="Source-supported Overture ID; repeat to link one finding to multiple records")
    approve_case.add_argument("--verified-at", required=True, help="YYYY-MM-DD human verification date")
    approve_case.add_argument("--approved-by", required=True)
    approve_case.set_defaults(func=cmd_approve_case)
    auto_dry = sub.add_parser("auto-dry-run", help="Evaluate evidence-gated publication without writing files")
    auto_dry.add_argument("--as-of", help="Evaluation date in YYYY-MM-DD format")
    auto_dry.set_defaults(func=cmd_auto_dry_run)
    auto_publish = sub.add_parser("auto-publish", help="Publish only cases that pass all evidence and identity gates")
    auto_publish.add_argument("--as-of", help="Publication date in YYYY-MM-DD format")
    auto_publish.set_defaults(func=cmd_auto_publish)
    rollback = sub.add_parser("rollback", help="Undo a publication using its recorded snapshot")
    rollback.add_argument("snapshot_id")
    rollback.set_defaults(func=cmd_rollback)
    approve = sub.add_parser("approve", help="Manually verify and publish an ownership classification")
    approve.add_argument("business_id")
    approve.add_argument("entity_id")
    approve.add_argument("--classification", required=True, choices=sorted(CLASSES))
    approve.add_argument("--evidence-url", required=True)
    approve.add_argument("--evidence-note", required=True)
    approve.add_argument("--verified-at", required=True, help="YYYY-MM-DD")
    approve.add_argument("--approved-by", required=True)
    approve.set_defaults(func=cmd_approve)
    args = parser.parse_args()
    try:
        args.func(args)
    except (ValueError, KeyError, json.JSONDecodeError) as exc:
        print(f"Error: {exc}", file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
