# SubdivideIQ Overnight Log — 6 April 2026

## Session start
**Date:** 6 April 2026
**State at start:** Sprint 1-4 complete. SubdivideIQ launched today. Fixing BUG-1 through BUG-6.

---

## BUG-1: Confirmation page hangs after payment
**Status:** COMPLETE
- Root cause: Stripe webhook retries created duplicate DB rows. report-status.js used .single() which throws PGRST116 on >1 row → eternal PENDING.
- Fix: report-status.js uses limit(1) + array access. webhook.js adds dedup check before processing.
- Secondary issue (BUG-1B): stepIdx declared after animateSteps() call — ReferenceError crashed page before pollStatus() fired. Fixed by moving declarations before if(!sessionId) block.
- Confirmed working in production: AMBER result renders correctly for session cs_live_a1qgKMl6...

## BUG-2: lotsize error when DCDB parcel lookup fails
**Status:** COMPLETE
- Root cause: check-lotsize.js returned 400 error on null area_m2.
- Fix: returns GREY / NOT_AVAILABLE — excluded from flag counts.

## BUG-3: Infrastructure charge defaults to BCC when council is null
**Status:** COMPLETE
- Root cause: null council fell through `council && council !== 'brisbane'` guard to BCC rates.
- Fix: changed to `!council || council !== 'brisbane'`.

## BUG-4: what_to_do_next step 4 hardcoded as BCC
**Status:** COMPLETE
- Root cause: buildConsultantSequence hardcoded "Infrastructure charges (BCC)".
- Fix: reads checks.zone?.council — BCC gets ICR label, others get "contact your council".

## BUG-5: Stripe webhooks firing for wrong product
**Status:** COMPLETE
- Root cause: webhook processed payments from all Stripe products on the account.
- Fix: checkout.js adds product: 'subdivideiq' to session metadata. webhook.js rejects if product !== 'subdivideiq'.

## BUG-6: UTF-8 encoding — verify fix
**Status:** COMPLETE (no code change)
- Verified: m² renders cleanly in production curl output. charset fix confirmed working.

## Smoke tests
6/6 passing after all fixes.

---

## Commits this session
- fix: BUG-1 through BUG-6 post-launch fixes
- fix: explicit GREEN/AMBER/RED check in confirmation polling
- fix: move stepIdx and steps declarations before animateSteps call to fix ReferenceError
