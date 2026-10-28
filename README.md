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
