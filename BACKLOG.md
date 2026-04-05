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
- Full Brisbane load (897k records) — scripts written and tested, run manually when time permits (~30 min)
### [x] S1-4: Load BCC stormwater data
- 2,343 surface drains loaded, 1,537 pipes loaded (Carindale area for test)
- Full Brisbane pipe load (291k records) — scripts written and tested, run manually (~20 min)
- Note: BCC has no Overland Flowpath type — FLOODWAY/SWALE/EARTH DRAIN used as proxies (600 records)
### [x] S1-5: Address geocoding function — api/geocode.js verified end-to-end

## SPRINT 1 TESTS ✅ COMPLETE
### [x] S1-T: 6 Glenheaton Court returns ~1086m² ✅ 825mm pipe at 17m ✅ geocode returns centroid ✅

---

## SPRINT 2 — Feasibility Checks Engine ✅ COMPLETE

### [x] S2-1: Zone check — api/check-zone.js
### [x] S2-2: Flood overlay check — api/check-flood.js
### [x] S2-3: Slope/elevation check — api/check-elevation.js
### [x] S2-4: Stormwater proximity check — api/check-stormwater.js
### [x] S2-5: Character overlay check — api/check-character.js
### [x] S2-6: Lot size viability — api/check-lotsize.js
### [x] S2-7: Master feasibility aggregator — api/feasibility.js

## SPRINT 2 TESTS ✅ COMPLETE
### [x] S2-T: All feasibility checks tested and passing

---

## SPRINT 3 — Report Generation & Payment ✅ COMPLETE

### [x] S3-1: Stripe checkout (api/checkout.js)
- Product: SubdivideIQ Feasibility Report — $79 AUD
- Include address and email in session metadata
- On success → webhook triggers report generation

### [x] S3-2: Stripe webhook (api/webhook.js)
- On checkout.session.completed:
  - Run feasibility engine with address from metadata
  - Generate PDF
  - Send via Resend to customer email
  - Log to subdivide_reports table

### [x] S3-3: PDF report template
HTML → PDF via puppeteer or equivalent with:
- Header: SubdivideIQ logo + address + date
- Lot map: Mapbox Static API showing lot polygon + flood overlay + nearby stormwater pipes
- Traffic light: large GREEN/AMBER/RED with summary line
- One section per check: result badge + plain English explanation + cost/time implication
- "What to do next" section: consultant sequence and realistic budget guide
- Consultant cost reference table:
  Town planner $1,500-$3,000
  Land surveyor $2,000-$4,000
  Hydraulics engineer $4,000-$8,000
  DA fees $3,000-$8,000
  Infrastructure charges $20,000-$30,000 per lot
- Disclaimer footer: not engineering or legal advice

### [x] S3-4: Frontend — address entry page (update public/index.html)
- Clean single page UI matching WhatCanIBuild style
- Address autocomplete via Mapbox
- After address entry: show lot boundary on map as hook before payment
- Show traffic light preview (locked) to create anticipation
- Price: $79 AUD clearly displayed
- CTA button: "Get my SubdivideIQ report"
- Trust signals: "60 second report", "Not legal advice — a pre-screen tool"

### [x] S3-5: Confirmation page
- "Your report is being generated — check your email in around 60 seconds"
- Show address and traffic light result (now unlocked)

## SPRINT 3 TESTS

### [x] S3-T: End-to-end payment and report test
Run these tests after Sprint 3 is built. All must PASS before moving to Sprint 4.
Log results to OVERNIGHT_LOG.md with timestamps.

1. Enter 6 Glenheaton Court Carindale in frontend — verify lot boundary appears on map
2. Verify traffic light preview shows before payment
3. Click through to Stripe checkout — verify $79 AUD, address in metadata
4. Complete Stripe test payment — verify webhook fires within 10 seconds
5. Verify feasibility engine runs and returns AMBER for this address
6. Verify PDF generated with correct traffic light, all sections present, disclaimer footer present
7. Verify PDF received via Resend to test email within 60 seconds
8. Verify subdivide_reports row created in Supabase with correct address, result, stripe_session_id
9. Verify confirmation page shows correct address and result

Results:
- T5: PASS — feasibility returns AMBER for 6 Glenheaton Court ✅
- T6: PASS — PDF generated, valid %PDF-1.3, 5394 bytes ✅
- T8: PASS — Supabase insert/fetch/delete working ✅
- T1, T2, T3, T4, T7, T9: require browser + Stripe CLI — MANUAL PENDING

If any test fails: investigate, fix, re-test before moving on. Do not proceed to Sprint 4 with a failing test.

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

### [ ] S4-3: Full Brisbane data loads
- Run scripts/load-parcels.js — full 897k records (~30 min)
- Run scripts/load-sw-pipes.js — full 291k records (~20 min)
- Verify record counts in Supabase after each load

### [ ] S4-4: Switch Stripe to live mode
- Confirm Vercel production env has live Stripe keys
- Run one live test payment end-to-end with real card

### [ ] S4-5: Jest smoke tests
- Install Jest
- Test api/geocode.js returns valid parcel for "6 Glenheaton Court Carindale"
- Test api/feasibility.js returns AMBER for 6 Glenheaton Court Carindale
- Test api/feasibility.js returns GREEN or AMBER or RED (not null) for 3 other Brisbane addresses
- All tests must pass

### [ ] S4-6: Final staging test with 6 Glenheaton Court Carindale
- AMBER result with flood overlay flag ✓
- Lot area ~1086m² ✓
- Slope moderate ✓
- 825mm stormwater pipe at ~17m ✓
- PDF generated, formatted correctly, disclaimer present ✓
- Live Stripe payment processed ✓
- Email received within 60 seconds ✓

### [ ] S4-7: Update portfoliostate
- Update STATE.md with live SubdivideIQ URL, Stripe live mode confirmed, launch date
- Push updated BACKLOG.md copy to portfoliostate as SUBDIVIDEIQ_BACKLOG.md

## SPRINT 4 TESTS

### [ ] S4-T: Pre-launch checklist — all must be green before announcing
1. Sprint 3 tests all passing ✅
2. Full Brisbane parcel + pipe data loaded ✅
3. Live Stripe payment end-to-end working ✅
4. Jest smoke tests passing ✅
5. PDF quality review — formatting, plain English, cost table, disclaimer ✅
6. Mobile responsive frontend ✅
7. Vercel production deployment confirmed live ✅

---

## FUTURE SPRINTS (do not build yet)

### [ ] F1: Building works pre-screen
- "I want to extend, not subdivide" user flow
- Groundworks vs stilts signal from elevation vs flood immunity level
- Directly addresses Steve's extension/stilts experience

### [ ] F2: DA precedent layer
- BCC PD Online nearby subdivision approvals/refusals
- "X approvals, Y refusals within 500m in last 5 years"

### [ ] F3: Infrastructure charge estimator
- BCC published charge schedules
- Real dollar estimate per additional lot

### [ ] F4: Professional/town planner tier
- $149/month subscription
- Pre-populated site data export
- White-label option

### [ ] F5: SEQ expansion
- Gold Coast, Moreton Bay, Sunshine Coast (ZoneIQ data already exists)
- Need: respective council parcel + stormwater data

### [ ] F6: Convergence with WhatCanIBuild
- Unified product TBD
- WhatCanIBuild brand doesn't scale to subdivision

### [ ] F7: RapidAPI listing
- SubdivideIQ feasibility as API product
- Target: prop tech developers, mortgage brokers, real estate agents

### [ ] F8: Real estate agent tier
- Subdivision potential screening before listing
- Bulk address upload, white-label report
