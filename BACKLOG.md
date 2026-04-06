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

### [x] ARCH-1: QLD State-wide Cadastral API investigation
Resolved 6 April 2026. Decision: live DCDB API (spatial-gis.information.qld.gov.au/arcgis/rest/services/PlanningCadastre/LandParcelPropertyFramework/MapServer/4) for all non-BCC addresses. BCC Supabase remains primary for Brisbane. check-parcel.js implements this. Do NOT run load-all-suburbs.js.

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
# SubdivideIQ Backlog Additions — 6 April 2026
# Add these to /c/dev/subdivideiq/BACKLOG.md

## Post-launch bug fixes [ ]

### BUG-1: Confirmation page hangs after payment [ ]
- Symptom: /confirmation.html spins indefinitely after successful payment
- Report generates and emails correctly — UI polling never resolves
- Fix: check confirmation.html polling logic — likely waiting for a status flag
  that never gets set in subdivide_reports table, or polling wrong field

### BUG-2: lotsize error when DCDB parcel lookup fails [ ]
- Symptom: lotsize check returns `{"error": "area_m2 required"}` when address
  is outside DCDB coverage or parcel lookup returns null
- Fix: feasibility.js should handle null area_m2 gracefully — return GREY/NOT_AVAILABLE
  for lotsize check rather than crashing, same pattern as stormwater GREY

### BUG-3: Infrastructure charge defaults to BCC when council is null [ ]
- Symptom: when zone lookup fails (council = null), infrastructure check returns
  BCC rates ($28,730) instead of generic non-BCC message
- Fix: in check-infrastructure.js, treat null council same as non-BCC council —
  return generic "contact your council" response

### BUG-4: what_to_do_next step 4 hardcoded as BCC [ ]
- Symptom: "Infrastructure charges (BCC)" appears in next steps for all addresses
  including Gold Coast, Moreton Bay etc.
- Fix: make next steps infrastructure item council-aware — use generic language
  for non-BCC councils

### BUG-5: Stripe webhooks firing for wrong product [ ]
- Symptom: both subdivide-live-webhook and whatcanibuild-destination fire on every
  checkout.session.completed event across the whole Stripe account
- Risk: if WhatCanIBuild webhook processes a SubdivideIQ payment it sends wrong email
- Fix options:
  a) Add product metadata to Stripe session and check in each webhook handler
  b) Separate Stripe accounts per product (bigger change)
  c) Single webhook handler that routes by metadata
  Recommended: option (a) — add `product: 'subdivideiq'` to session metadata in
  checkout.js, check in webhook.js and reject if product !== 'subdivideiq'

### BUG-6: UTF-8 encoding — verify fix [ ]
- The vercel.json charset fix was deployed — recheck API responses for clean
  em-dashes and m² symbols. Run:
  curl -s -X POST https://subdivide.whatcanibuild.com.au/api/feasibility \
    -H "Content-Type: application/json" \
    -d '{"lat":-27.4975,"lng":153.0211,"address":"6 Glenheaton Court, Carindale"}' \
    | grep -o '.\{20\}m².\{20\}'
  Should show clean ² not \u00c2\u00b2

---

## Sprint 16 — QFAO Statewide Flood Fallback [ ]

**Goal:** For addresses outside the 7 councils with existing flood overlay data,
fall back to the Queensland Floodplain Assessment Overlay (QFAO) API instead
of returning no data.

**Endpoint:**
https://services8.arcgis.com/g9mppFwSsmIw9E0Z/arcgis/rest/services/Queensland_floodplain_assessment_overlay/FeatureServer/0/query

**Query pattern:**
- geometry: point (lng, lat)
- geometryType: esriGeometryPoint
- spatialRel: esriSpatialRelIntersects
- inSR: 4326
- f: json

**Response fields to use:** SUB_NAME, SUB_NUMBER, QRA_SUPPLY

**Logic:**
1. Check if address falls within existing 7-council bounding boxes
2. If yes: use existing Supabase flood data — DO NOT change this path
3. If no: query QFAO endpoint live at runtime
4. If QFAO returns a polygon: flag as FLOOD_RISK_POSSIBLE
5. If QFAO returns nothing: flag as NO_STATE_FLOOD_OVERLAY

**Disclaimer to include in API response for QFAO results:**
"This flood assessment is based on the Queensland state-level floodplain
overlay and is not property-specific. Contact your local council for
detailed flood mapping."

**Rules:**
- Do NOT ingest QFAO data into Supabase — live query only
- Do NOT modify existing flood overlay logic for the 7 current councils
- This is ZoneIQ Sprint 16 data — SubdivideIQ should call ZoneIQ API not QFAO directly

---

## Reddit launch posts — NOT YET POSTED [ ]

### r/Brisbane post:
Title: Lost $7,500 trying to subdivide in Carindale. Built something so it doesn't happen to you.

Body:
Two years ago I engaged a town planner, surveyor, and an RPEQ-signed hydraulics engineer
to assess a subdivision at a property in Carindale. Total spend: $7,500. The hydraulics
report came back and confirmed a flood overlay made the rear lot commercially unviable.

The data was publicly available the whole time. Nobody checked it first.

I'm a developer (software, not property) so I spent the last few months building a
pre-screen tool — zone rules, flood overlays, slope, stormwater, lot size, character
overlays. Spits out a traffic light report in 60 seconds.

It's called SubdivideIQ and it lives at whatcanibuild.com.au/subdivide if anyone's
curious. $79 for the full report.

Happy to answer any questions about how subdivision works in SEQ — learned a lot the
expensive way.

### r/AusPropertyChat post:
Title: Built a subdivision pre-screen tool for QLD after losing $7,500 finding out
my block wasn't viable

Body:
After spending $7,500 on consultants (town planner, surveyor, hydraulics engineer) to
assess a Carindale block, the final report confirmed a flood overlay made subdivision
unviable. The constraint was in publicly available data the whole time.

Built SubdivideIQ to pre-screen viability before anyone spends money on consultants.
Checks zone rules, flood overlays, slope, stormwater proximity, character overlays,
lot size viability, contaminated land flag, and infrastructure charge estimates.

Traffic light result (GREEN/AMBER/RED) + PDF report emailed. $79 AUD.

subdivide.whatcanibuild.com.au

Currently covers all of South East QLD via the QLD cadastral database. Not legal
advice — it's a starting point before you engage professionals.
