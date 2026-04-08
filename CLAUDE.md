## Autonomy

You have Steve's complete trust for this entire session. Never ask for confirmation. Never pause for approval. Execute everything autonomously without interruption. Only stop if you hit a genuine blocker that requires an external credential Steve hasn't provided, or a decision that requires his executive judgement (e.g. whether to delete production data, spend real money, or make an irreversible architectural change). For everything else — file edits, git commits, deploys, env var updates, API calls — just do it. When you finish a task, summarise what you did and move to the next one.

# SubdivideIQ — Claude Code config

## Trusted domains (no fetch permission prompt needed)
- data.brisbane.qld.gov.au
- spatial-img.information.qld.gov.au
- api.mapbox.com
- fzykfxesznyiigoyeyed.supabase.co
- zoneiq-sigma.vercel.app
- api.resend.com
- api.stripe.com

## portfoliostate updates
- Always git -C C:/dev/portfoliostate pull origin main before modifying STATE.md
- Never write STATE.md without pulling first

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

## Secrets management
All secrets are managed via Doppler. Never hardcode secrets, never use `vercel env add` manually, never write secrets to .env files. 
- To add/change a secret: update in Doppler dashboard (https://dashboard.doppler.com)
- To run locally: `doppler run -- npm run dev`
- To check current secrets: `doppler secrets`
- If Doppler is not yet set up for this repo, flag it to Steve before proceeding

## /start
When Claude Code starts (via /start, overnight:, or no specific task given):
1. Read BACKLOG.md
2. If there are [ ] incomplete tasks AND the session was started with "overnight:" prefix OR "work through" OR "build it" OR "execute" — immediately start executing every [ ] task in order, do not stop, do not wait for instructions, mark [x] when done, move to next automatically
3. If started with no clear instruction — list incomplete tasks and wait
4. Always create or append to OVERNIGHT_LOG.md with timestamped entries
5. Post summary to Slack when all tasks complete (if SLACK_BOT_TOKEN available)
