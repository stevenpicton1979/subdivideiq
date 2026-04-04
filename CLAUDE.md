# SubdivideIQ — Claude Code config

## Trusted domains (no fetch permission prompt needed)
- data.brisbane.qld.gov.au
- spatial-img.information.qld.gov.au
- api.mapbox.com
- fzykfxesznyiigoyeyed.supabase.co
- zoneiq-sigma.vercel.app
- api.resend.com
- api.stripe.com

## Critical rules
- Never combine cd and git in the same command
- Use $func$ not $$ for Supabase SQL functions
- Always call zoneiq-sigma.vercel.app NOT zoneiq.com.au for server-side ZoneIQ fetches
- Supabase v2: use try/catch not .catch() chaining
- Repo branch: main (not master)

## ZoneIQ data already in Supabase fzykfxesznyiigoyeyed
Tables ready for SubdivideIQ to query:
- zone_geometries — zone polygons + rules
- flood_overlays — BCC flood planning categories 1-5 + overland flow
- character_overlays — character overlay polygons
- school_catchments — school catchment polygons

## SubdivideIQ-specific tables (created in Sprint 1)
- subdivide_parcels — BCC parcel boundaries (DCDB)
- subdivide_sw_pipes — BCC stormwater pipe network
- subdivide_sw_drains — BCC surface drains + overland flow paths
- subdivide_reports — purchased feasibility reports

## How to start overnight build
cd C:\dev\subdivideiq
claude --dangerously-skip-permissions
Prompt: "Read BACKLOG.md and work through every [ ] task in Sprint N. Do not stop between tasks. Mark [x] when done. Commit after each sprint. Push at the end."
