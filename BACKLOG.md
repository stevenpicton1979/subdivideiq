# SubdivideIQ — BACKLOG
Last updated: 6 April 2026
Repo: stevenpicton1979/subdivideiq ✅ CREATED

## How to use this file
Start Claude Code in the subdivideiq repo and say:
"Read BACKLOG.md and work through every [ ] task. Do not stop. Mark [x] when done. Move to next task automatically."

---

## SPRINT 1 — Foundation & Lot Data

### [x] S1-1: Create repo and project scaffold
- Create repo: stevenpicton1979/subdivideiq on GitHub
- Copy scaffold from buyerside repo (same vanilla HTML/CSS/JS + Vercel serverless structure)
- Set up Vercel project linked to repo
- Create .env.example with: SUPABASE_URL, SUPABASE_SERVICE_KEY, STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, RESEND_API_KEY, MAPBOX_TOKEN
- Create CLAUDE.md with trusted domains

### [x] S1-2: Supabase tables
In project fzykfxesznyiigoyeyed, create:

subdivide_parcels:
- id bigserial primary key
- lot text, plan text, address text, area_m2 numeric
- geom geometry(MultiPolygon, 4326)
- GiST index on geom

subdivide_sw_pipes:
- id bigserial primary key
- pipe_id text, material text, diameter_mm numeric
- geom geometry(LineString, 4326)
- GiST index on geom

subdivide_sw_drains:
- id bigserial primary key
- drain_id text, drain_type text
- geom geometry(MultiLineString, 4326)
- GiST index on geom

subdivide_reports:
- id bigserial primary key
- address text, lot text, plan text
- result text (GREEN/AMBER/RED)
- flags jsonb
- stripe_session_id text, email text
- created_at timestamptz default now()

Use $func$ not $$ for Supabase SQL functions.

### [x] S1-3: Load BCC parcel data
- Download GeoJSON from BCC Open Data parcel dataset
- Write scripts/load-parcels.js
- Transform to WGS84, load into subdivide_parcels
- Verify: query for 6 Glenheaton Court Carindale — should return lot polygon + ~1086m² area
- NOTE: Full Brisbane loads (load-parcels.js ~897k records, load-sw-pipes.js ~291k records) — scripts written and tested, run manually when time permits (~50 min total).

### [x] S1-4: Load BCC stormwater data
- Download stormwater pipes GeoJSON from BCC Open Data
- Download surface drains GeoJSON from BCC Open Data
- Write scripts/load-sw-pipes.js and scripts/load-sw-drains.js
- Load into respective tables
- Verify: query pipes near 6 Glenheaton Court — should find the 825mm pipe from the hydraulics report

### [x] S1-5: Address geocoding function
- Create api/geocode.js
- Input: address string
- Geocode via Mapbox → lat/lng
- PostGIS query to find matching parcel
- Output: { lot, plan, area_m2, geom_geojson, centroid_lat, centroid_lng }

---

## SPRINT 2 — Feasibility Checks Engine

### [x] S2-1: Zone check (api/check-zone.js)
- Query ZoneIQ zone_geometries (already in Supabase)
- Output: zone_code, zone_name, min_lot_size_m2
- Logic: both new lots must meet minimum → PASS/MARGINAL/FAIL

### [x] S2-2: Flood overlay check (api/check-flood.js)
- Query ZoneIQ flood_overlays (already in Supabase)
- Calculate % of lot covered by each flood planning category
- Category 1-2 → RED
- Category 3 + >50% coverage → RED
- Category 3-5 any coverage → AMBER + hydraulics report flag ($4k-$8k, 6-8 weeks)
- Overland flow present → AMBER
- Output includes plain English consequence and build form flag

### [x] S2-3: Slope/elevation check (api/check-elevation.js)
- Sample 9 points across lot bounding box (3x3 grid)
- Query QLD ArcGIS ImageServer for each point:
  https://spatial-img.information.qld.gov.au/arcgis/rest/services/Elevation/QldDem/ImageServer/identify
- Calculate min/max elevation and slope %
- FLAT <2% GREEN, MODERATE 2-10% AMBER, STEEP >10% AMBER/RED
- If flood overlay present: compare min_elev to flood immunity level
  If min_elev < (flood_level + 0.5m) → flag "groundworks unlikely to achieve immunity, stilts likely"

### [x] S2-4: Stormwater proximity check (api/check-stormwater.js)
- ST_DWithin query on subdivide_sw_pipes — nearest pipe distance
- ST_DWithin query on subdivide_sw_drains — overland flow proximity
- Pipe <30m → GREEN, 30-80m → AMBER, >80m → AMBER/RED
- Mapped overland flow within 100m → AMBER

### [x] S2-5: Character overlay check (api/check-character.js)
- Query ZoneIQ character_overlays (already in Supabase)
- Output: in_character_overlay, overlay_name, demolition_note

### [x] S2-6: Lot size viability (api/check-lotsize.js)
- Calculate indicative split: 60/40 front/rear and battle-axe options
- Check each new lot against zone minimum
- Output: split_viable, front_lot_m2, rear_lot_m2, battle_axe_viable, frontage_width_m

### [x] S2-7: Master feasibility aggregator (api/feasibility.js)
- Call all checks in parallel via Promise.all
- Any RED → overall RED
- 2+ AMBER → overall AMBER (leaning RED)
- 1 AMBER → overall AMBER
- All GREEN → overall GREEN
- Return complete feasibility object

---

## SPRINT 3 — Report Generation & Payment

### [ ] S3-1: Stripe checkout (api/checkout.js)
- Product: SubdivideIQ Feasibility Report — $79 AUD
- Include address in session metadata
- On success → webhook triggers report generation

### [ ] S3-2: Stripe webhook (api/webhook.js)
- On checkout.session.completed:
  - Run feasibility engine
  - Generate PDF
  - Send via Resend
  - Log to subdivide_reports

### [ ] S3-3: PDF report template
HTML → PDF with:
- Header: address + date
- Lot map: Mapbox Static API showing lot polygon + flood overlay + nearby stormwater pipes
- Traffic light: large GREEN/AMBER/RED
- One section per check with result badge + plain English + cost/time implication
- "What to do next" section — consultant sequence and budget guide
- Consultant cost reference table (town planner $1.5-3k, surveyor $2-4k, hydraulics $4-8k, DA $3-8k, infrastructure charges $20-30k per lot)
- Disclaimer footer

### [ ] S3-4: Frontend — address entry page
- Clean single page UI (same style as WhatCanIBuild)
- Address autocomplete via Mapbox
- After address entry: show lot boundary on map as hook before payment
- Price: $79
- CTA: "Get my SubdivideIQ report"

### [ ] S3-5: Confirmation page
- "Your report is being generated — check your email in 60 seconds"

---

## SPRINT 4 — Launch Prep

### [ ] S4-1: Vercel environment variables (Production + Preview)
- SUPABASE_URL, SUPABASE_SERVICE_KEY
- STRIPE_SECRET_KEY (live), STRIPE_WEBHOOK_SECRET (live)
- STRIPE_SECRET_KEY_TEST, STRIPE_WEBHOOK_SECRET_TEST (preview)
- RESEND_API_KEY, MAPBOX_TOKEN

### [ ] S4-2: CLAUDE.md trusted domains
- data.brisbane.qld.gov.au
- spatial-img.information.qld.gov.au
- api.mapbox.com
- fzykfxesznyiigoyeyed.supabase.co

### [ ] S4-3: Staging test with 6 Glenheaton Court Carindale
- Verify: AMBER result with flood overlay flag
- Verify: lot area ~1086m²
- Verify: slope moderate
- Verify: 825mm stormwater pipe detected nearby
- Verify: PDF generated and emailed correctly

### [ ] S4-4: Update portfoliostate repo
- Update STATE.md with live SubdivideIQ details once launched

---

## FUTURE SPRINTS (do not build yet)

### [ ] F1: Building works pre-screen
- Separate user flow: "I want to extend, not subdivide"
- Key output: groundworks vs stilts signal from elevation vs flood immunity level
- Directly addresses Steve's extension/stilts experience

### [ ] F2: DA precedent layer
- Scrape BCC PD Online for nearby subdivision DAs
- Display: "X approvals, Y refusals within 500m in last 5 years"

### [ ] F3: Infrastructure charge estimator
- BCC charge schedules are published
- Show real dollar estimate per additional lot

### [ ] F4: Professional/town planner tier
- $149/month subscription
- Pre-populated site data export
- White-label option

### [ ] F5: SEQ expansion
- Gold Coast, Moreton Bay, Sunshine Coast (ZoneIQ data already exists)
- Need: respective council parcel + stormwater data

### [ ] F6: Convergence with WhatCanIBuild
- Both share ZoneIQ data engine
- Unified product TBD — naming under consideration
- WhatCanIBuild brand doesn't scale to subdivision use case
