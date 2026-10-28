# Sorta Local

A map-first prototype for exploring home services, dental, veterinary, and auto repair businesses in Hampton Roads, Virginia.

## Run locally

```sh
npm install
npm run dev
npm run build
```

The map uses OpenFreeMap's Liberty style with OpenStreetMap data and needs an internet connection. Attribution is shown on the map. HVAC listings are imported from Overture Maps; dental, veterinary, and auto repair records remain fictional demos.

Location search defaults to Norfolk within 15 miles. ZIP lookup uses bundled Census 2026 ZCTA internal points, not a paid geocoder; ZCTAs are not exact USPS delivery areas. ZIP centroid source attribution is shown in the sidebar.

## Refresh HVAC listings

```sh
python -m pip install -r scripts/requirements.txt
python scripts/import_overture_hvac.py
```

The importer pins release `2026-10-21.0`, clips listings to Overture boundary polygons for Suffolk, Chesapeake, Portsmouth, Norfolk, Virginia Beach, Hampton, and Newport News, and writes `src/overtureHvacListings.json` with counts, exclusions, source IDs, and incomplete-field flags. Imported ownership is always unknown with no relationships or evidence. The map and Overture source records require an internet connection.

The seven-city HVAC extent also includes Virginia Beach, Hampton, and Newport News. Refresh the bundled regional ZIP lookup with `python scripts/import_zip_centroids.py`; it downloads the Census Gazetteer and clips ZCTA centroids to the same Overture city polygons.

## Manual ownership research (prototype)

Ownership research data is isolated in `data/`. `ownershipRegistry.json` contains clearly fictional demo entities and placeholder evidence; it must not be used to classify Overture businesses. `publicOwnership.json` starts empty and is not consumed by the frontend. Candidate matches never update source listings or assign ownership.

Generate a local review queue using the empty, real research registry by default:

```sh
python scripts/ownership_research.py match
```

Select another registry with `python scripts/ownership_research.py match --registry data/realOwnershipRegistry.json`. The fictional examples remain in `data/ownershipRegistry.json`; queues generated from any registry marked `fictional_demo_only` are review-only and the approval command refuses to publish them. New real records belong in `data/realOwnershipRegistry.json` and must carry `dataStatus: "real_research"`.

Review `data/ownershipResearchQueue.json`, then explicitly approve a verified candidate by providing its business/entity IDs, a non-unknown classification, a real HTTPS evidence URL, a verification date, and reviewer name:

```sh
python scripts/ownership_research.py approve BUSINESS_ID ENTITY_ID --classification private_equity_backed --evidence-url https://source.example/article --evidence-note "Ownership disclosed in source" --verified-at 2026-10-01 --approved-by "Reviewer name"
```

Source-backed acquisition and ownership candidates are maintained in `data/ownershipResearchCases.json`. Stage them into the existing review queue and regenerate the separate prioritization output with:

```sh
python3 scripts/ownership_research.py stage-cases
python3 scripts/ownership_research.py discover
```

Cases marked `ready_for_human_approval` can be approved with `approve-case`. Repeat `--business-id` only for records whose identity is supported by the source; unresolved record IDs are excluded:

```sh
python3 scripts/ownership_research.py approve-case CASE_ID --business-id BUSINESS_ID --verified-at YYYY-MM-DD --approved-by "Reviewer name"
```

This command records one approved finding against each selected original Overture ID without merging the listings. Affiliation-only and franchise-network cases cannot be approved as local ownership classifications until their legal ownership is established.

## Evidence-gated automatic verification

The optional automatic publication path uses only the source facts and identity evidence already staged in `ownershipResearchQueue.json`. It makes no web/API calls. The default configuration at `data/ownershipAutomationConfig.json` disables optional research and sets its spending limits to $0.

Inspect proposed changes without writing any files:

```sh
python3 scripts/ownership_research.py auto-dry-run
```

Publish cases that pass the source, relationship, and per-listing identity gates:

```sh
python3 scripts/ownership_research.py auto-publish
```

Each actual publication writes a targeted pre-publication snapshot under `data/ownershipSnapshots/` and an evidence fingerprint cache at `data/ownershipVerificationCache.json`. Unchanged evidence is recognized by its fingerprint; no repeated external research is performed.

To undo a specific automated publication, use the snapshot ID printed by `auto-publish`:

```sh
python3 scripts/ownership_research.py rollback SNAPSHOT_ID
```

Rollback removes only records and registry relationships/entities added by that publication, restores previous mappings and review status, and marks the snapshot rolled back. Dry-run never modifies public data, cache, queue, registry, or snapshots.

Approval writes a validated entry to the separate public dataset. The script does no web access or scraping. Registry relationships and brand names provide match context; candidate confidence is only a review aid. The matcher accepts source listings as read-only and real listing ownership remains unknown until a human verifies evidence and approves it.

Run focused safeguards with `python -m unittest discover -s tests`. The repo's `npm run lint` covers frontend source; Python scripts use only the standard library.
