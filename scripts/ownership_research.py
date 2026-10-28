#!/usr/bin/env python3
"""Manual ownership research queue and approval tools; no scraping or auto-classification."""
from __future__ import annotations

import argparse
import json
import re
import sys
from datetime import date
from difflib import SequenceMatcher
from pathlib import Path
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parents[1]
LISTINGS = ROOT / "src" / "overtureHvacListings.json"
REGISTRY = ROOT / "data" / "ownershipRegistry.json"
QUEUE = ROOT / "data" / "ownershipResearchQueue.json"
PUBLIC = ROOT / "data" / "publicOwnership.json"
CLASSES = {"independent", "private_equity_backed", "public_company", "subsidiary", "unknown"}


def load(path: Path):
    with path.open(encoding="utf-8") as f:
        return json.load(f)


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


def cmd_match(_args):
    queue = generate_queue(load(LISTINGS), load(REGISTRY))
    QUEUE.write_text(json.dumps(queue, indent=2) + "\n", encoding="utf-8")
    print(f"Wrote {len(queue['entries'])} candidate businesses to {QUEUE.relative_to(ROOT)}")


def cmd_approve(args):
    queue = load(QUEUE)
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
           "classification": args.classification, "verifiedAt": args.verified_at,
           "approvedAt": date.today().isoformat(), "approvedBy": args.approved_by,
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


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(required=True)
    match = sub.add_parser("match", help="Generate candidate queue from current Overture listings")
    match.set_defaults(func=cmd_match)
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
