# SubdivideIQ — BACKLOG
Last updated: 6 April 2026
Repo: stevenpicton1979/subdivideiq

## How to use this file
Start Claude Code in the subdivideiq repo and say:
"Read BACKLOG.md and work through every [ ] task. Do not stop. Mark [x] when done. Move to next task automatically."

---

## SPRINT 1 — Foundation & Lot Data ✅ COMPLETE

### [x] S1-1: Create repo and project scaffold
### [x] S1-2: Supabase tables — subdivide_parcels, subdivide_sw_pipes, subdivide_sw_drains, subdivide_reports
### [x] S1-3: Load BCC parcel data
- 16,115 parcels loaded (partial Brisbane — Carindale area confirmed working)
- Full Brisbane load script: scripts/load-all-suburbs.js (195 suburbs, ~60 min, ~773k records)
- NOTE: Do not run full load until ARCH-1 investigation is complete
### [x] S1-4: Load BCC stormwater data
- 12,037 pipes + 2,343 surface drains loaded
- Note: BCC has no Overland Flowpath type — FLOODWAY/SWALE/EARTH DRAIN used as proxies
### [x] S1-5: Address geocoding — api/geocode.js
- Mapbox autocomplete → PostGIS parcel lookup
- bbox fixed to correct negative latitudes for Brisbane (-28.2 to -26.8)
- Mapbox token fetched from /api/config (not hardcoded)

## SPRINT 1 TESTS ✅ COMPLETE
### [x] S1-T: 6 Glenheaton Court returns lot 15 RP182797 1086m² ✅ 825mm pipe at 17m ✅ geocode returns centroid ✅

---

## SPRINT 2 — Feasibility Checks Engine ✅ COMPLETE

### [x] S2-1: Zone check — api/check-zone.js
- Thresholds calibrated (PL-1): GREEN >2.1×min, AMBER ≥1.5×min, RED <1.5×min
### [x] S2-2: Flood overlay check — api/check-flood.js
- FHA_R1/R2A/R2B → RED; FHA_R3 any coverage → AMBER; FHA_R4/R5 → AMBER
### [x] S2-3: Slope/elevation check — api/check-elevation.js
- FLAT (<2%) → GREEN; MODERATE (2-10%) → AMBER; STEEP (>10%) → AMBER
### [x] S2-4: Stormwater proximity check — api/check-stormwater.js
- <30m → GREEN; 30-80m → AMBER; >80m → AMBER
### [x] S2-5: Character overlay check — api/check-character.js
- Overlay present → AMBER; none → GREEN
### [x] S2-6: Lot size viability — api/check-lotsize.js
- RED threshold aligned: halfLot < minLot×0.75
### [x] S2-7: Master feasibility aggregator — api/feasibility.js
- 10 checks in parallel; mock req/res includes setHeader()

## SPRINT 2 TESTS ✅ COMPLETE
### [x] S2-T: All feasibility checks tested and passing

---

## SPRINT 2B — High Value Data Enhancements ✅ COMPLETE

### [x] S2B-1: Contaminated land check — api/check-contaminated.js
- QLD EMR/CLR has no public coordinate-based API (confirmed April 2026)
- Returns AMBER stub with manual check URL (environment.des.qld.gov.au)
- api_gap: true

### [x] S2B-2: Infrastructure charge estimator — api/check-infrastructure.js
- BCC ICR 2026: Urban LDR $28,730/lot, Township LDR $20,000/lot
- Charge schedule: data/infrastructure-charges.json
- Always AMBER (known mandatory cost, not a blocker)

### [x] S2B-3: Powerline easement check — api/check-easements.js
- Live ArcGIS lookup: BCC City Plan 2014 high voltage easements layer
- Point-in-polygon → RED; 50m buffer → AMBER; clear → GREEN
- Energex raw GIS data not publicly available

### [x] S2B-4: Acid sulfate soils check — api/check-acidsulfate.js
- Live ArcGIS: City_Plan_2014_PotentialAndActual_acid_sulfate_soils_overlay
- Overlay present → AMBER; clear → GREEN

## SPRINT 2B TESTS ✅ COMPLETE
### [x] S2B-T: All 4 checks pass (April 2026)
- Contaminated: AMBER (api_gap) ✅
- Infrastructure: $28,730/lot Carindale ✅
- Easements: AMBER at (-27.548657, 153.030267) ✅
- Acid sulfate: AMBER at Toowong (-27.467, 153.028), GREEN at Carindale ✅

---

## SPRINT 3 — Report Generation & Payment ✅ COMPLETE

### [x] S3-1: Stripe checkout — api/checkout.js
- $79 AUD, lat/lng passed in session metadata, BASE_URL → subdivideiq.vercel.app

### [x] S3-2: Stripe webhook — api/webhook.js
- processReport() awaited before res.json() (races 25s timeout — Stripe won't kill it)
- geocode → feasibility → PDF → Resend email → Supabase log

### [x] S3-3: PDF report — api/generate-pdf.js
- pdfkit (pure Node.js, no puppeteer — works in Vercel serverless)
- Dark brand cover bar, address block, traffic light panel, per-check sections
- "What to do next" consultant sequence, cost table, disclaimer footer
- Page numbers on all pages (bufferPages + switchToPage pattern)

### [x] S3-4: Frontend — public/index.html
- Mapbox autocomplete → lot boundary map → locked traffic light preview → email → payment
- Mapbox token from /api/config (not hardcoded placeholder)
- sessionStorage saves address for confirmation page

### [x] S3-5: Confirmation page — public/confirmation.html
- Polls /api/report-status, animates step list, shows traffic light + per-check results
- All 10 check labels mapped

## SPRINT 3 TESTS ✅ COMPLETE
### [x] S3-T: End-to-end pipeline confirmed working (6 April 2026)
- Autocomplete → lot boundary → Stripe → webhook → feasibility → PDF → email ✅
- T5: feasibility returns AMBER for 6 Glenheaton Court ✅
- T6: PDF generated, valid %PDF, 10,770 bytes ✅
- T8: Supabase insert/fetch working ✅
- T1-T4, T7, T9: browser flow confirmed working in production session ✅

---

## SPRINT 4 — Launch Prep

### [x] S4-1: Vercel environment variables (Production)
- 9 production env vars set: SUPABASE_URL, SUPABASE_SERVICE_KEY, DATABASE_URL, STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, RESEND_API_KEY, MAPBOX_TOKEN, ALLOWED_ORIGIN, NODE_ENV
- Fix applied: all ALLOWED_ORIGIN reads use .trim() to guard against \n corruption

### [x] S4-2: CLAUDE.md trusted domains
- data.brisbane.qld.gov.au, spatial-img.information.qld.gov.au, api.mapbox.com, fzykfxesznyiigoyeyed.supabase.co, api.resend.com, api.stripe.com, services2.arcgis.com

### [x] S4-3: Staging test — 6 Glenheaton Court Carindale
- Zone: AMBER (1086m² LDR, was wrongly RED before PL-1 fix) ✅
- Overall: AMBER, 0 RED ✅
- PDF: 10,770 bytes, valid %PDF ✅
- Full pipeline: PASS ✅

### [ ] S4-4: Switch Stripe to live mode
- Confirm Vercel production env has live Stripe keys
- Run one live test payment end-to-end with real card

### [x] S4-5: Jest smoke tests
- tests/smoke.test.js: 6 tests, 6 passing

### [x] S4-6: Final staging test — confirmed complete (see S4-3)

### [x] S4-7: State management updated
- Switched to Option C: STATE.md in portfoliostate is overview only
- SUBDIVIDEIQ_BACKLOG.md removed from portfoliostate (stale duplicate)
- This BACKLOG.md is the source of truth

## SPRINT 4 TESTS

### [ ] S4-T: Pre-launch checklist — all must pass before announcing
1. Full browser end-to-end payment with real card (Stripe live mode) ✅ PENDING
2. Full Brisbane parcel + pipe data loaded — pending ARCH-1 decision
3. Live Stripe payment processed ✅ PENDING
4. Jest smoke tests passing ✅
5. PDF quality reviewed ✅
6. Mobile responsive frontend ✅
7. Vercel production confirmed live ✅

---

## PRODUCT LOGIC FIXES

### [x] PL-1: Traffic light calibration — done 6 April 2026
- check-zone: RED only if lotArea < minLot×1.5. 1086m² LDR → AMBER (was RED)
- check-flood: FHA_R3 >50% coverage → AMBER (was RED)
- check-lotsize: RED threshold halfLot < minLot×0.75 (was 0.9)
- All other checks reviewed — thresholds correct

---

## PRE-LAUNCH TASKS

### [ ] ARCH-1: QLD State-wide Cadastral API investigation
DECISION: Before running load-all-suburbs.js, test the QLD DCDB real-time API.

Background: SubdivideIQ currently uses bulk BCC parcel data (Brisbane only, partial load).
Expanding to Gold Coast/Moreton Bay etc requires separate bulk loads per council —
expensive on Supabase storage. QLD Government maintains a state-wide Digital Cadastral
Database (DCDB) accessible via QSPATIAL WFS endpoint — query by coordinate at runtime,
covers all QLD, no bulk storage needed.

Steve's preference: real-time API + Supabase cache on first lookup per address.

Investigation steps:
1. Find the QSPATIAL WFS endpoint for DCDB parcel layer
2. Test coordinate lookup for:
   - -27.5107753964089, 153.101573168291 (Brisbane — 6 Glenheaton Court)
   - -27.9700, 153.4000 (Gold Coast)
   - -27.0333, 152.9667 (Moreton Bay)
3. Measure response time
4. If <5 seconds and returns valid lot polygon: write api/geocode-qld.js,
   test 5 SEQ addresses, report in OVERNIGHT_LOG.md, add task to replace
   BCC bulk approach with real-time + Supabase cache
5. If unreliable or >5s: fall back to running load-all-suburbs.js

DO NOT run load-all-suburbs.js until this investigation is complete.

### [ ] DOMAIN: Purchase subdivideiq.com.au
- Register via VentraIP (same account as other domains)
- Add to Vercel as custom domain
- Update BASE_URL env var in Vercel production

### [ ] LAUNCH: Go live
- Switch Stripe to live mode (S4-4)
- Run ARCH-1 or load-all-suburbs.js (full parcel data)
- Post on r/Brisbane
- Post on r/brisbane_flooding or similar

---

## FUTURE SPRINTS (do not build yet)

### [ ] F1: Building works pre-screen
- "I want to extend, not subdivide" user flow
- Groundworks vs stilts signal from elevation vs flood immunity level

### [ ] F2: DA precedent layer
- BCC PD Online nearby subdivision approvals/refusals within 500m

### [ ] F4: Professional/town planner tier
- $149/month subscription, pre-populated site data export

### [ ] F5: SEQ expansion
- Gold Coast, Moreton Bay, Sunshine Coast
- Depends on ARCH-1 outcome (real-time DCDB vs per-council bulk loads)

### [ ] F6: Convergence with WhatCanIBuild
- Unified product TBD

### [ ] F7: RapidAPI listing
- SubdivideIQ feasibility as API product

### [ ] F8: Real estate agent tier
- Bulk address upload, white-label report
