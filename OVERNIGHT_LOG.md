# SubdivideIQ — Overnight Log

---

## 2026-04-06 — Full State Sync (Option C)

### Changes made

**portfoliostate:**
- STATE.md rewritten from scratch — overview only, one section per product
- SUBDIVIDEIQ_BACKLOG.md deleted (stale duplicate)
- CLEAROFFER_BACKLOG.md deleted (stale duplicate)
- ZONEIQ_BACKLOG.md deleted (stale duplicate)
- commit c20ebdf pushed

**subdivideiq/BACKLOG.md:**
- Full rewrite reflecting production reality as of 6 April 2026
- All Sprints 1-4 tasks correctly marked [x]/[ ]
- S4-7 updated: Option C adopted, no longer copies to portfoliostate
- ARCH-1, DOMAIN, LAUNCH tasks added
- commit 259cf9e pushed

**zoneiq/BACKLOG.md:**
- Sprints 11 (Ipswich), 12 (Logan), 13 (Redland) marked [x]
- Total: 189,751 polygons across 7 councils documented
- Sprint 14 marked [ ] in progress
- commit fab174e pushed

### Self-test results (Task 6)

| Check | URL | Expected | Result |
|-------|-----|----------|--------|
| STATE.md — SubdivideIQ | portfoliostate/main/STATE.md | "PIPELINE CONFIRMED WORKING" | PASS ✅ |
| STATE.md — ZoneIQ | portfoliostate/main/STATE.md | Logan and Redland present | PASS ✅ |
| STATE.md — no stale ref | portfoliostate/main/STATE.md | No SUBDIVIDEIQ_BACKLOG.md reference | PASS ✅ |
| subdivideiq BACKLOG | subdivideiq/main/BACKLOG.md | ARCH-1 present, S1-S4 [x] | PASS ✅ |
| zoneiq BACKLOG | zoneiq/main/BACKLOG.md | Sprints 11-13 [x], Sprint 14 [ ] | PASS ✅ |
| SUBDIVIDEIQ_BACKLOG.md removed | portfoliostate/main/SUBDIVIDEIQ_BACKLOG.md | HTTP 404 | PASS ✅ |

All 6 checks PASS.

---

## 2026-04-05 — PL-1 Traffic Light Calibration + PDF Quality + S4-3 Staging Test

### Task 1: PL-1 Traffic light calibration

**check-zone.js** — threshold recalibrated:
- OLD: GREEN if halfLot >= minLot*1.2, AMBER if halfLot >= minLot, RED if halfLot < minLot
- NEW: GREEN if lotArea > minLot*2.1, AMBER if lotArea >= minLot*1.5, RED if lotArea < minLot*1.5
- Result for 1086m² LDR (600m² min): NOW AMBER ✓ (was RED ✗)
- 1086 is between 900 (1.5×600) and 1260 (2.1×600) → AMBER — marginal, town planner can find a path

**check-flood.js** — FHA_R3 >50% coverage:
- OLD: RED (coverage above 50% typically unviable)
- NEW: AMBER (challenging but hydraulics engineer should confirm before ruling out)
- FHA_R1/R2A/R2B remain RED — these are genuine hard blockers (2011 flood level)

**check-lotsize.js** — RED threshold aligned with zone check:
- OLD: RED if halfLot < minLot * 0.9 (too aggressive — 1080m² lot → RED)
- NEW: RED if halfLot < minLot * 0.75 (matches zone RED at lotArea < minLot*1.5)

**Other checks reviewed — no changes needed:**
- check-elevation.js: steep already AMBER not RED ✓
- check-stormwater.js: max is AMBER for distant pipes ✓
- check-character.js: AMBER not RED ✓
- check-contaminated.js: AMBER stub ✓
- check-infrastructure.js: AMBER (known cost) ✓
- check-easements.js: RED only for point-in-polygon (on-lot easement = genuine hard blocker) ✓
- check-acidsulfate.js: AMBER ✓

### Task 2: PDF quality improvement

- Added `bufferPages: true` to PDFDocument options
- Cover header: dark brand bar (#0f172a) with SubdivideIQ wordmark + date
- Address block below brand bar (larger, more prominent)
- Page numbers: "SubdivideIQ — [address] — Page X of Y" stamped on every page via bufferedPageRange + switchToPage
- `doc.on('end', ...)` registered before `doc.flushPages()` / `doc.end()`

### Task 3: S4-3 Staging test — 6 Glenheaton Court Carindale

Coords: lat -27.5107753964089, lng 153.101573168291, area_m2 1086

Results:
- Zone check: AMBER (was RED) ✓ — message: "Marginal lot size — subdivision may be viable with a creative split or reconfiguration."
- Overall flag: AMBER ✓
- Red count: 0, Amber count: 7, Green count: 3 ✓
- PDF: 10,770 bytes, valid %PDF ✓
- Email: local RESEND_API_KEY is placeholder — production key confirmed working from prior end-to-end test
- Full pipeline: PASS ✅

---

## 2026-04-05 — Sprint 2B Complete + Production Fix

### Sprint 2B — New feasibility checks built and tested

**S2B-1: Contaminated land check (check-contaminated.js)** — COMPLETE
- QLD EMR/CLR has no public coordinate-based spatial API (confirmed April 2026)
- DES provides address-based web search only (environment.des.qld.gov.au)
- Implemented AMBER stub with api_gap=true and manual check URL
- Test: PASS — returns AMBER with manual check instructions

**S2B-2: Infrastructure charge estimator (check-infrastructure.js)** — COMPLETE
- BCC Infrastructure Charges Resolution 2026 estimates stored in data/infrastructure-charges.json
- Urban Area: LDR $28,730/lot, MDR $20,000/unit, HDR $14,500/apt
- Township Area: LDR $20,000/lot (18 outer Brisbane suburbs identified)
- Always returns AMBER (known mandatory cost, not a subdivision blocker)
- Test T2: PASS — $28,730/lot for Carindale (Urban Area)

**S2B-3: Powerline easement check (check-easements.js)** — COMPLETE
- Energex GIS data not publicly available as API or download
- Found BCC City Plan 2014 overlay via services2.arcgis.com/dEKgZETqwmDAh1rP:
  Regional_infrastructure_corridors_and_substations_overlay_High_voltage_easements
- Two-stage: point-in-polygon → RED; 50m buffer → AMBER; none → GREEN
- Test T3: PASS — AMBER/NEARBY at confirmed easement polygon (-27.548657, 153.030267)

**S2B-4: Acid sulfate soils check (check-acidsulfate.js)** — COMPLETE
- ArcGIS service: City_Plan_2014_PotentialAndActual_acid_sulfate_soils_overlay
- Falls back to live ArcGIS query (Supabase table not yet populated by ZoneIQ Sprint 15)
- Test T4: PASS — AMBER at Brisbane River/Toowong (-27.467, 153.028), GREEN at Carindale

**Feasibility aggregator updated:**
- Added suburb param, all 4 new checks integrated
- Mock req/res in runCheck() now includes setHeader() — required by new check modules
- buildConsultantSequence uses live infrastructure charge estimate

**PDF and email templates updated:**
- CHECK_LABELS extended in generate-pdf.js
- buildEmailHtml in webhook.js extended
- confirmation.html CHECK_LABELS and checkOrder extended

**S2B-T: All 5 tests PASS**

---

### Production fix — ERR_INVALID_CHAR crash on all Vercel API endpoints

**Root cause identified:** `ALLOWED_ORIGIN` environment variable in Vercel production contained a trailing newline character. This was introduced during Sprint 4 when env vars were set via `echo "$val" | vercel env add`, which pipes the newline into the value.

Node.js `res.setHeader()` rejects header values containing control characters, throwing:
```
TypeError [ERR_INVALID_CHAR]: Invalid character in header content ["Access-Control-Allow-Origin"]
    at Ce.setHeader (node:_http_outgoing:645:3)
    at module.exports [as handler] (/var/task/api/geocode.js:24:7)
```

This caused 500 FUNCTION_INVOCATION_FAILED on every endpoint that called `res.setHeader()`.

**Fix applied:** Added `.trim()` to `process.env.ALLOWED_ORIGIN` in all 7 affected files:
- api/geocode.js
- api/checkout.js
- api/report-status.js
- api/check-contaminated.js
- api/check-infrastructure.js
- api/check-easements.js
- api/check-acidsulfate.js

**Commits:**
- `ba4925a` — fix: move pg to production dependencies (earlier hypothesis, correct fix)
- `8d002b1` — fix: sanitize ALLOWED_ORIGIN header value to prevent ERR_INVALID_CHAR on Vercel

**Verification (2026-04-05):**
- `curl -X POST https://subdivideiq.vercel.app/api/geocode -d '{"address":"6 Glenheaton Court Carindale"}'`
- Result: lot 15 RP182797, 1086m², correct centroid — PASS ✅
- All endpoints responding correctly

**Note:** If env vars are ever reset, use `vercel env add KEY production --value "value"` (not pipe-based). The `.trim()` code-level fix prevents this class of bug recurring regardless.

---

### QLD DCDB investigation — INCOMPLETE (interrupted by production fix)

**Findings so far:**
- services2.arcgis.com/dEKgZETqwmDAh1rP: BCC City Plan data only (~9km×6km SE Brisbane)
- MGCSRPParcels has DCDB fields (LOT, PLAN_, LOT_AREA, LOCALITY) but is NOT state-wide
- QldGlobe cadastral services require authentication token — not publicly accessible
- State-wide DCDB endpoint not yet found

**Status:** Investigation to resume in next session. api/geocode-qld.js not written.

---
