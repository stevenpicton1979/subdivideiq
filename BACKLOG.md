# SubdivideIQ — BACKLOG
Last updated: 7 April 2026
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

## SPRINT 4 — Launch Prep ✅ COMPLETE

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

### [x] S4-4: Switch Stripe to live mode
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
1. Full browser end-to-end payment with real card (Stripe live mode) ✅ DONE
2. Full Brisbane parcel + pipe data loaded — pending ARCH-1 decision
3. Live Stripe payment processed ✅ DONE
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

## SPRINT 5 — Report Depth, Value & Coverage ✅ COMPLETE

### [x] S5-0: Coverage disclosure
- Add notice to index.html below search card: "Currently covers all of South East Queensland — Brisbane, Gold Coast, Moreton Bay, Sunshine Coast, Ipswich, Logan and Redland councils."
- Add coverage line to PDF disclaimer section
- Add `coverage_warning` field to feasibility.js API response when council is null
- Display amber banner on confirmation.html if `coverage_warning` present

### [x] S5-1: Expand per-check narratives
- Richer template messages for all 10 checks — PASS/MARGINAL/FAIL variants for zone, RED/AMBER/NONE for flood, STEEP/MODERATE/FLAT for slope, etc.
- Ensure `cost_time_implication` populated for all relevant states

### [x] S5-2: Key Numbers block in PDF
- Two-column table after traffic light panel: lot area, zone, min lot size, indicative split, buffer above minimum, infra charge, council, "pre-screen saved $7,500"

### [x] S5-3: AI-driven consultant sequencing
- buildConsultantSequence priority rules: contaminated first, flood RED → hydraulics before planner, steep → geotech before surveyor

### [x] S5-4: Risk summary on confirmation page
- "Watch out for" section above check list showing RED/AMBER checks with one-line implications

### [x] S5-5: "Cost saved" callout on confirmation page
- Green callout box below traffic light banner; add red count message if RED checks present

### [x] S5-6: Data sources and scope disclosure in PDF
- "What SubdivideIQ Checked — and What It Didn't" section before disclaimer

### [x] S5-7: Free instant pre-screen on landing page
- Auto-call /api/check-zone and /api/check-flood after address selection
- Show inline zone + flood badges on map panel

### [x] S5-8: Download PDF button on confirmation page
- New api/download-report.js endpoint (regenerate PDF from stored feasibility data)
- Add download button to confirmation.html

### [x] S5-9: Update BACKLOG.md — mark all S5 tasks [x]

---

## Sprint 6 — Stormwater expansion: 6 non-BCC councils [ ]

**Goal:** Replace GREY/NOT_AVAILABLE stormwater result for Gold Coast, Moreton Bay, Sunshine Coast, Ipswich, Logan and Redland with live nearest-pipe queries. Same logic as existing BCC check — return distance and pipe size where available.

**Approach:** Realtime ArcGIS/WFS queries at runtime. Do NOT load into Supabase — pipe networks are too large, change regularly, and only the nearest feature is needed.

**Data sources (confirmed):**

Gold Coast:
- Drainage pipe: https://data-goldcoast.opendata.arcgis.com/datasets/68958fec01c844b1893c2df7bf1c7068_1
- ArcGIS FeatureServer — query nearest pipe to point, return distance + diameter

Moreton Bay:
- Stormwater line: https://datahub-moretonbay.hub.arcgis.com/datasets/moretonbay::cmb-council-assets?layer=25
- Moreton Bay DataHub ArcGIS — confirmed publicly queryable

Sunshine Coast:
- Stormwater Pipe (Council): https://data.sunshinecoast.qld.gov.au/datasets/scrcpublic::stormwater-pipe-council/about
- ArcGIS Hub — confirmed publicly accessible

Ipswich:
- Drainage Mains: https://data.gov.au/data/dataset/ipswich-city-drainage-mains
- WFS/GeoJSON via data.gov.au — slightly different format to ArcGIS, use WFS API link

Logan:
- Check: https://data-logancity.opendata.arcgis.com for a drainage/stormwater pipe layer
- Water asset data confirmed exists — verify stormwater pipe layer specifically before building

Redland:
- Asset mapping MapServer: https://gis.redland.qld.gov.au/arcgis/rest/services/assets/a_asset_mapping/MapServer
- Same server used for Redland zone data in Sprint 13 — stormwater layer confirmed in service

**Implementation:**
1. In api/check-stormwater.js, detect council from the zone lookup result
2. Route to the appropriate council's ArcGIS/WFS endpoint based on council value
3. Query nearest pipe within 150m of the lat/lng point
4. Return same response shape as BCC: { flag, distance_m, pipe_diameter_mm }
5. If council ArcGIS query fails or times out, return GREY gracefully — do not crash
6. Add all 6 council endpoints to CLAUDE.md trusted domains

**Tests:**
- Gold Coast: known address in Gold Coast LDR zone — verify stormwater returns distance not GREY
- Moreton Bay: 1 Anzac Ave Redcliffe — verify result
- Sunshine Coast: 1 Duporth Ave Maroochydore — verify result
- Ipswich: known Ipswich residential address — verify result
- Logan: known Logan residential address — verify result
- Redland: known Redland residential address — verify result

---

## Sprint 7 — Sewer proximity check: Gold Coast, Logan, Redland [ ]

**Goal:** Add sewer proximity as a new feasibility check. Sewer connection distance is a major cost driver for subdivision — a 50m connection vs 5m can be $10,000–$30,000 difference. Currently not checked for any council.

**Approach:** Realtime ArcGIS queries. BCC sewer data not publicly available (Urban Utilities restriction). Gold Coast, Logan, Redland confirmed available. Moreton Bay, Sunshine Coast, Ipswich covered by Urban Utilities — API access unconfirmed, return GREY for these.

**Data sources (confirmed):**

Gold Coast:
- Sewer Pipe Non Pressure: https://data-goldcoast.opendata.arcgis.com/datasets/ffa11b9070484df3b5bef5d1e4592a8e_1
- Sewer Pipe Pressure: https://data-goldcoast.opendata.arcgis.com/datasets/2d448614ede743edaa09aeb7036a7d4f_1
- Query both layers, return nearest

Logan:
- Logan Water Asset Location Data: https://data-logancity.opendata.arcgis.com/maps/d348c07f3a844b3b990d47626b73dc15
- Verify sewer pipe layer exists within this service before building

Redland:
- Same asset MapServer as stormwater: https://gis.redland.qld.gov.au/arcgis/rest/services/assets/a_asset_mapping/MapServer
- Sewer layer confirmed in service description

**Response shape:**
{ flag, distance_m, note }
- GREEN: sewer within 30m
- AMBER: sewer 30–100m ("Connection may require extended pipe run — budget $5,000–$20,000")
- GREY: data not available for this council ("Contact council for sewer connection point — distance drives cost significantly")

**Not covered yet (return GREY):**
- Brisbane (Urban Utilities restriction)
- Moreton Bay, Sunshine Coast, Ipswich (Urban Utilities — investigate API access separately)

**Implementation:**
1. Create api/check-sewer.js — new check file, same pattern as check-stormwater.js
2. Add to feasibility.js parallel checks
3. Add CHECK_LABELS entry in generate-pdf.js and confirmation.html
4. Add to buildConsultantSequence: if sewer AMBER → note in civil engineer step "confirm sewer connection point and distance before committing to lot layout"

---

## Sprint 8 — Vegetation protection overlay: Brisbane [ ]

**Goal:** Check if the lot has BCC protected vegetation — Significant Urban Vegetation (SUV), Significant Native Vegetation (SNV), or Waterway/Wetland Vegetation. A protected tree in the rear lot area can cost $5,000–$50,000 to deal with, require an arborist report as a DA condition, or prevent a viable lot configuration entirely.

**Approach:** Realtime ArcGIS point-in-polygon query against BCC open data layers. Brisbane only — other councils have different regimes.

**Data sources (all confirmed via data.brisbane.qld.gov.au and QLD Open Data):**
- Significant Urban Vegetation: BCC City Plan 2014 open data ArcGIS layer
- Significant Native Vegetation: BCC City Plan 2014 open data ArcGIS layer
- Waterway and Wetland Vegetation: BCC Natural Assets Local Law 2003 layer

**Note:** Recently protected vegetation (last 6 weeks) and VPOs on development conditions are NOT included in these datasets. Report must include this caveat.

**Response shape:**
- RED: waterway/wetland vegetation overlaps lot — clearing likely refused
- AMBER: SUV or SNV present — arborist report required as DA condition, tree removal permit needed
- GREEN: no protected vegetation mapped on lot
- GREY: non-Brisbane address — not checked

**Disclaimer to include:** "This check reflects mapped protected vegetation only. Recently protected trees and VPOs attached to development conditions are not included. Use BCC's Protected Vegetation Online Enquiry Tool to obtain a complete property report before proceeding."

**Implementation:**
1. Create api/check-vegetation.js
2. Query all three BCC ArcGIS layers in parallel — point-in-polygon
3. Worst result wins (RED > AMBER > GREEN)
4. Add to feasibility.js, generate-pdf.js, confirmation.html
5. Add to consultant sequence: if vegetation AMBER/RED → arborist comes before town planner ("A protected tree assessment must inform the lot layout before a planner can assess the DA")

---

## Sprint 9 — Road frontage calculation [ ]

**Goal:** Calculate street frontage width from existing parcel geometry and flag if insufficient for a battle-axe (rear access) lot. Minimum frontage for a battle-axe handle in most SEQ councils is 3m–6m depending on zone. A lot with 10m frontage can achieve this easily; a lot with 6m frontage cannot fit a driveway AND a rear lot handle simultaneously.

**Approach:** Pure code — no new data source needed. Parcel boundary geometry already available from BCC Supabase load and DCDB API for non-BCC. Calculate the boundary segment(s) adjacent to the road and return the total frontage width.

**Implementation:**
1. In api/check-parcel.js (or a new api/check-frontage.js), use the parcel polygon geometry returned by the zone/parcel lookup
2. Identify the road-facing boundary — longest boundary segment that faces the street (use bearing from centroid to boundary midpoint vs street direction as a heuristic, or use the known road geometry if available)
3. Calculate length of that segment in metres
4. Return: { frontage_m, flag, note }
   - GREEN: frontage ≥ 15m ("Sufficient frontage for a standard battle-axe handle")
   - AMBER: frontage 8–15m ("Tight frontage — surveyor must confirm handle width is achievable within setback requirements")
   - RED: frontage < 8m ("Very tight frontage — rear lot access handle may not be achievable. Engage a surveyor before proceeding.")
5. Add to feasibility.js, generate-pdf.js, confirmation.html
6. Add to consultant sequence: if frontage RED → surveyor before town planner ("Confirm access handle is geometrically achievable before spending on planning")

**Note:** Frontage calculation from polygon geometry is an approximation — always disclaim as indicative. The surveyor will confirm exact dimensions.

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

## Post-launch bug fixes [x] COMPLETE

### BUG-1: Confirmation page hangs after payment [x]
- Symptom: /confirmation.html spins indefinitely after successful payment
- Report generates and emails correctly — UI polling never resolves
- Fix: check confirmation.html polling logic — likely waiting for a status flag
  that never gets set in subdivide_reports table, or polling wrong field

### BUG-2: lotsize error when DCDB parcel lookup fails [x]
- Symptom: lotsize check returns `{"error": "area_m2 required"}` when address
  is outside DCDB coverage or parcel lookup returns null
- Fix: feasibility.js should handle null area_m2 gracefully — return GREY/NOT_AVAILABLE
  for lotsize check rather than crashing, same pattern as stormwater GREY

### BUG-3: Infrastructure charge defaults to BCC when council is null [x]
- Symptom: when zone lookup fails (council = null), infrastructure check returns
  BCC rates ($28,730) instead of generic non-BCC message
- Fix: in check-infrastructure.js, treat null council same as non-BCC council —
  return generic "contact your council" response

### BUG-4: what_to_do_next step 4 hardcoded as BCC [x]
- Symptom: "Infrastructure charges (BCC)" appears in next steps for all addresses
  including Gold Coast, Moreton Bay etc.
- Fix: make next steps infrastructure item council-aware — use generic language
  for non-BCC councils

### BUG-5: Stripe webhooks firing for wrong product [x]
- Symptom: both subdivide-live-webhook and whatcanibuild-destination fire on every
  checkout.session.completed event across the whole Stripe account
- Risk: if WhatCanIBuild webhook processes a SubdivideIQ payment it sends wrong email
- Fix options:
  a) Add product metadata to Stripe session and check in each webhook handler
  b) Separate Stripe accounts per product (bigger change)
  c) Single webhook handler that routes by metadata
  Recommended: option (a) — add `product: 'subdivideiq'` to session metadata in
  checkout.js, check in webhook.js and reject if product !== 'subdivideiq'

### BUG-6: UTF-8 encoding — verify fix [x]
- The vercel.json charset fix was deployed — recheck API responses for clean
  em-dashes and m² symbols. Run:
  curl -s -X POST https://subdivide.whatcanibuild.com.au/api/feasibility \
    -H "Content-Type: application/json" \
    -d '{"lat":-27.4975,"lng":153.0211,"address":"6 Glenheaton Court, Carindale"}' \
    | grep -o '.\{20\}m².\{20\}'
  Should show clean ² not \u00c2\u00b2

### BUG-1B: Confirmation page JS crash — stepIdx ReferenceError [x]
- Symptom: confirmation.html loaded but pollStatus() never fired — no network requests made
- Root cause: stepIdx and steps array declared with let AFTER the if(!sessionId) block that calls animateSteps() — JavaScript temporal dead zone caused ReferenceError on page load
- Fix: moved stepIdx and steps declarations to before the if(!sessionId) block
- Confirmed: page now renders AMBER result correctly in production (6 April 2026)

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

## Known Data Limitations

- [ ] Add flood data disclaimer to report: "Flood risk is based on BCC City Plan 2014 flood planning area overlays. Some areas near flood boundaries may not be formally classified despite proximity to flood zones. Always verify with council."

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
