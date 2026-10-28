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

Generate a local review queue with:

```sh
python scripts/ownership_research.py match
```

Review `data/ownershipResearchQueue.json`, then explicitly approve a verified candidate by providing its business/entity IDs, a non-unknown classification, a real HTTPS evidence URL, a verification date, and reviewer name:

```sh
python scripts/ownership_research.py approve BUSINESS_ID ENTITY_ID --classification private_equity_backed --evidence-url https://source.example/article --evidence-note "Ownership disclosed in source" --verified-at 2026-10-01 --approved-by "Reviewer name"
```

Approval writes a validated entry to the separate public dataset. The script does no web access or scraping. Registry relationships and brand names provide match context; candidate confidence is only a review aid. The matcher accepts source listings as read-only and real listing ownership remains unknown until a human verifies evidence and approves it.

Run focused safeguards with `python -m unittest discover -s tests`. The repo's `npm run lint` covers frontend source; Python scripts use only the standard library.
