# Project guidance

- Keep this prototype frontend-only; do not add a backend, database, authentication, or business API.
- Dental, veterinary, and auto directory records are fictional demo data. HVAC listings are imported from Overture Maps in `src/overtureHvacListings.json`.
- Never present imported unknown ownership as verified or infer a classification from missing information; imported records carry no ownership relationships or evidence.
- Keep business data separate from UI components and regenerate Overture HVAC records with `scripts/import_overture_hvac.py`.
- Validate changes with `npm run build`.

- The current main-page design is the user-approved visual baseline. Preserve its typography, branding, and layout unless the user explicitly requests a visual change.
