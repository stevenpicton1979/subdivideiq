/**
 * feasibility.js — Master feasibility aggregator for SubdivideIQ
 *
 * POST /api/feasibility
 * Body: { lat, lng, geom_geojson, area_m2 }
 *
 * Runs all 10 feasibility checks in parallel via Promise.all, then aggregates:
 *   Any RED → overall RED
 *   2+ AMBER → overall AMBER (leaning RED, noted)
 *   1 AMBER → overall AMBER
 *   All GREEN → overall GREEN
 *
 * Sprint 2B additions: contaminated, infrastructure, easements, acidsulfate
 *
 * Returns the complete feasibility object including:
 * - Overall traffic light result
 * - Per-check results with plain English and cost/time implications
 * - "What to do next" consultant sequence
 * - Flood immunity signal for elevation/stilts check
 */

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).end()

  const { lat, lng, geom_geojson, suburb } = req.body || {}
  let { area_m2 } = req.body || {}
  if (!lat || !lng) return res.status(400).json({ error: 'lat and lng required' })

  // Resolve area_m2 from DCDB if not provided (covers non-BCC addresses)
  if (!area_m2) {
    area_m2 = await resolveAreaM2(lat, lng)
  }

  try {
    // 1. Run zone check first — need min_lot_size_m2 for lotsize check
    const zoneResult = await runCheck('check-zone', { lat, lng, area_m2 }, req)

    const minLot = zoneResult?.min_lot_size_m2 || 600

    // 2. Run flood check to get immunity level for elevation check
    const floodResult = await runCheck('check-flood', { lat, lng, geom_geojson, area_m2 }, req)

    // Extract flood immunity level (simplified: use 4m AHD for FHA_R3, 3.7m for R4, etc.)
    const floodImmunityM = deriveImmunityLevel(floodResult)

    // 3. Run all remaining checks in parallel
    const [
      elevResult, swResult, charResult, lotsizeResult,
      contamResult, infraResult, easementResult, acidResult
    ] = await Promise.all([
      runCheck('check-elevation',     { lat, lng, geom_geojson, flood_min_immunity_m: floodImmunityM }, req),
      runCheck('check-stormwater',    { lat, lng }, req),
      runCheck('check-character',     { lat, lng }, req),
      runCheck('check-lotsize',       { lat, lng, geom_geojson, area_m2, min_lot_size_m2: minLot }, req),
      runCheck('check-contaminated',  { lat, lng }, req),
      runCheck('check-infrastructure',{ lat, lng, suburb, council: zoneResult?.council }, req),
      runCheck('check-easements',     { lat, lng }, req),
      runCheck('check-acidsulfate',   { lat, lng }, req)
    ])

    const checks = {
      zone:          zoneResult,
      flood:         floodResult,
      elevation:     elevResult,
      stormwater:    swResult,
      character:     charResult,
      lotsize:       lotsizeResult,
      contaminated:  contamResult,
      infrastructure:infraResult,
      easements:     easementResult,
      acidsulfate:   acidResult
    }

    // Aggregate flags — GREY means data not available, treated as neutral (excluded from counts)
    const flags = Object.values(checks)
      .map(c => c?.flag)
      .filter(f => f && f !== 'GREY')

    const redCount = flags.filter(f => f === 'RED').length
    const amberCount = flags.filter(f => f === 'AMBER').length

    let overallFlag, overallStatus, overallSummary

    if (redCount > 0) {
      overallFlag = 'RED'
      overallStatus = 'NOT_VIABLE'
      const redChecks = Object.entries(checks)
        .filter(([, c]) => c?.flag === 'RED')
        .map(([name]) => name)
      overallSummary = `Subdivision is likely not viable based on: ${redChecks.join(', ')}. See individual check details below.`
    } else if (amberCount >= 2) {
      overallFlag = 'AMBER'
      overallStatus = 'PROCEED_WITH_CAUTION'
      overallSummary = `Subdivision may be viable but has ${amberCount} flags requiring investigation. Professional advice strongly recommended before spending money on consultants.`
    } else if (amberCount === 1) {
      overallFlag = 'AMBER'
      overallStatus = 'PROCEED_WITH_CAUTION'
      const amberCheck = Object.entries(checks).find(([, c]) => c?.flag === 'AMBER')?.[0]
      overallSummary = `Subdivision appears viable with one flag to investigate: ${amberCheck}. Review the detail below before engaging consultants.`
    } else {
      overallFlag = 'GREEN'
      overallStatus = 'LIKELY_VIABLE'
      overallSummary = 'No significant constraints identified. This lot appears to meet the basic criteria for subdivision. A town planner can confirm feasibility and guide the next steps.'
    }

    // Build "what to do next" consultant sequence
    const consultantSequence = buildConsultantSequence(checks, overallFlag)

    // Total indicative cost range
    const costRange = buildCostRange(checks, overallFlag)

    // Coverage warning — council is null means zone lookup found no data for this address
    const council = zoneResult?.council || null
    const coverageWarning = !council
      ? 'This address is outside SubdivideIQ\'s zone coverage area. Zone and character overlay checks returned no data. Other checks (flood, slope, stormwater, infrastructure) still ran using available data sources. Consult a local town planner for zone-specific guidance.'
      : null

    return res.json({
      overall: {
        flag: overallFlag,
        status: overallStatus,
        summary: overallSummary,
        red_count: redCount,
        amber_count: amberCount,
        green_count: flags.filter(f => f === 'GREEN').length,
        grey_count: Object.values(checks).filter(c => c?.flag === 'GREY').length
      },
      checks,
      coverage_warning: coverageWarning,
      what_to_do_next: consultantSequence,
      cost_range: costRange,
      address_meta: { lat, lng, area_m2 },
      generated_at: new Date().toISOString()
    })
  } catch (err) {
    console.error('feasibility aggregator error:', err.message)
    return res.status(500).json({ error: 'Feasibility check failed' })
  }
}

/**
 * Resolve area_m2 via check-parcel.js (BCC Supabase or QLD DCDB).
 * Called when the client didn't supply area_m2 — covers non-BCC SEQ addresses.
 */
async function resolveAreaM2(lat, lng) {
  return new Promise((resolve) => {
    const parcelHandler = require('./check-parcel')
    const mockReq = {
      method: 'GET',
      query: { lat: String(lat), lng: String(lng) }
    }
    const mockRes = {
      _status: 200,
      status(c) { this._status = c; return this },
      json(data) {
        resolve(data?.area_m2 ?? null)
      },
      end() { resolve(null) }
    }
    Promise.resolve(parcelHandler(mockReq, mockRes)).catch(() => resolve(null))
  })
}

/**
 * Run a named check by requiring its module and calling it with a mock req/res.
 * This avoids HTTP round-trips between serverless functions.
 */
async function runCheck(checkName, body, _parentReq) {
  return new Promise((resolve) => {
    const handler = require(`./${checkName}`)
    const mockReq = {
      method: 'POST',
      body,
      query: {}
    }
    const mockRes = {
      _status: 200,
      _body: null,
      setHeader() { return this },
      status(code) { this._status = code; return this },
      json(data) { this._body = data; resolve(data); return this },
      end() { resolve(null); return this }
    }
    Promise.resolve(handler(mockReq, mockRes)).catch(err => {
      console.error(`${checkName} failed:`, err.message)
      resolve({ check: checkName, flag: 'AMBER', error: err.message })
    })
  })
}

/**
 * Derive a flood immunity level from the flood check result.
 * Used to signal the elevation check whether stilts are likely.
 * Based on BCC City Plan 2014 flood immunity requirements.
 */
function deriveImmunityLevel(floodResult) {
  if (!floodResult || floodResult.flag === 'GREEN') return null
  const cat = floodResult.highest_category
  if (!cat) return null
  // Approximate AHD immunity levels (these vary by location — this is a signal only)
  const immunity = {
    FHA_R1: 5.0,   // Brisbane River 2011 flood + freeboard
    FHA_R2A: 4.5,
    FHA_R2B: 4.2,
    FHA_R3: 3.8,
    FHA_R4: 3.4,
    FHA_R5: 3.0,
    High: 4.0,     // Overland flow high
    Medium: 3.5,
    Low: 3.0
  }
  return immunity[cat] || null
}

/**
 * Build a priority-ordered consultant sequence for the "what to do next" section.
 * Rules:
 *   - Contaminated: check register (free) FIRST if flagged
 *   - Flood RED: hydraulics engineer BEFORE town planner
 *   - Steep slope: geotech BEFORE surveyor
 *   - Flood AMBER: hydraulics AFTER town planner
 */
function buildConsultantSequence(checks, overallFlag) {
  const steps = []
  const council = checks.zone?.council || null
  const isBcc   = council === 'brisbane'
  const infraCharge = checks.infrastructure?.estimated_charge_per_lot
    ? '$' + checks.infrastructure.estimated_charge_per_lot.toLocaleString('en-AU')
    : isBcc ? '$28,000–$32,000' : '$15,000–$40,000'

  // Step 0: Contaminated land register — free manual check, do before any spend
  if (checks.contaminated?.flag === 'AMBER') {
    steps.push({
      step: steps.length + 1,
      who: 'QLD DES contaminated land register (free check)',
      why: 'Before spending on professionals, verify the lot is not on the QLD Environmental Management Register (EMR) or Contaminated Land Register (CLR). Contamination can add $20,000–$100,000+ in remediation costs or render a subdivision commercially unviable.',
      cost: 'Free — search at environment.des.qld.gov.au',
      urgency: 'Do this before engaging any consultants'
    })
  }

  // Flood RED: hydraulics before town planner — confirms quickly if it\'s a hard no
  if (overallFlag === 'RED' && checks.flood?.flag === 'RED') {
    steps.push({
      step: steps.length + 1,
      who: 'Hydraulics engineer (RPEQ-signed)',
      why: 'The flood overlay on this lot is a high-risk category. Before spending on a town planner, a hydraulics engineer can quickly confirm whether the rear lot can achieve flood immunity — or whether the constraint is an absolute blocker.',
      cost: '$4,000–$8,000 for initial flood immunity assessment',
      urgency: 'First paid step — do this before engaging a town planner'
    })
    steps.push({
      step: steps.length + 1,
      who: 'Town planner',
      why: 'If the hydraulics engineer confirms flood immunity is achievable, a town planner can confirm whether the red flag constraints are engineerable — and what the full feasibility path looks like.',
      cost: '$500–$1,500 for an initial feasibility opinion',
      urgency: 'After hydraulics engineer assessment'
    })
    steps.push({
      step: steps.length + 1,
      who: isBcc ? 'Infrastructure charges (BCC ICR)' : 'Infrastructure charges (contact your council)',
      why: isBcc
        ? 'BCC levies infrastructure charges for each new lot created — this is a mandatory cost, not optional'
        : 'Your council levies infrastructure charges for each new lot created — rates differ by council.',
      cost: `${infraCharge} per additional lot (payable at DA approval)`,
      urgency: 'Factor into your financial model before any further spend'
    })
    return steps
  }

  // General RED (non-flood): town planner first
  if (overallFlag === 'RED') {
    steps.push({
      step: steps.length + 1,
      who: 'Town planner',
      why: 'Confirm whether the red flag constraints are absolute blockers or can be engineered around',
      cost: '$500–$1,500 for an initial feasibility opinion',
      urgency: 'Do this before spending anything else'
    })
    steps.push({
      step: steps.length + 1,
      who: isBcc ? 'Infrastructure charges (BCC ICR)' : 'Infrastructure charges (contact your council)',
      why: isBcc
        ? 'BCC levies infrastructure charges for each new lot created — mandatory cost'
        : 'Your council levies infrastructure charges for each new lot created. Confirm rates before budgeting.',
      cost: `${infraCharge} per additional lot (payable at DA approval)`,
      urgency: 'Factor into your financial model before any further spend'
    })
    return steps
  }

  // AMBER / GREEN: full sequence with priority ordering

  steps.push({
    step: steps.length + 1,
    who: 'Town planner',
    why: 'Confirm zone compliance, overlay implications, and the best split configuration for your lot',
    cost: '$1,500–$3,000',
    urgency: 'Start here — sets direction for everything else'
  })

  if (checks.flood?.flag !== 'GREEN') {
    steps.push({
      step: steps.length + 1,
      who: 'Hydraulics engineer (RPEQ-signed)',
      why: 'Required for any lot with flood overlay — assesses immunity levels and drainage requirements. Must be RPEQ-signed for council submission.',
      cost: '$4,000–$8,000',
      urgency: 'After town planner confirms overall viability'
    })
  }

  // Geotech BEFORE surveyor when steep
  if (checks.elevation?.slope_class === 'STEEP') {
    steps.push({
      step: steps.length + 1,
      who: 'Geotechnical engineer',
      why: 'Steep slope requires soil stability assessment for earthworks and footings — this affects both construction cost and whether the rear lot is commercially viable. Get this before committing to surveyor fees.',
      cost: '$3,000–$6,000',
      urgency: 'Before committing to surveyor and DA preparation'
    })
  }

  steps.push({
    step: steps.length + 1,
    who: 'Land surveyor (cadastral)',
    why: 'Prepares the plan of subdivision and lot boundaries for lodgement with council',
    cost: '$2,000–$4,000',
    urgency: 'After town planner confirms split configuration'
  })

  steps.push({
    step: steps.length + 1,
    who: 'Development application (DA)',
    why: 'Formal council approval for the subdivision — the town planner prepares and lodges this on your behalf',
    cost: '$3,000–$8,000 (council fees + planner preparation)',
    urgency: 'After all technical reports are complete'
  })

  steps.push({
    step: steps.length + 1,
    who: isBcc ? 'Infrastructure charges (BCC ICR)' : 'Infrastructure charges (contact your council)',
    why: isBcc
      ? 'BCC levies infrastructure charges for each new lot created — this is a mandatory cost, not optional'
      : 'Your council levies infrastructure charges for each new lot created — rates differ by council. Confirm the current amount with your council or town planner before budgeting.',
    cost: `${infraCharge} per additional lot (payable at DA approval)`,
    urgency: 'Factor into your financial model before engaging any consultants'
  })

  return steps
}

/**
 * Build indicative total cost range based on active flags.
 */
function buildCostRange(checks, overallFlag) {
  let low = 5500  // town planner + surveyor minimum
  let high = 15000

  if (checks.flood?.flag !== 'GREEN') {
    low += 4000; high += 8000
  }
  if (checks.elevation?.slope_class === 'STEEP') {
    low += 3000; high += 6000
  }
  if (checks.stormwater?.flag !== 'GREEN' && checks.stormwater?.flag !== 'GREY') {
    low += 5000; high += 30000
  }

  // DA + infrastructure charges (always applies if proceeding)
  low += 23000; high += 38000

  return {
    low: `$${(low / 1000).toFixed(0)}k`,
    high: `$${(high / 1000).toFixed(0)}k`,
    note: 'Indicative range — excludes land surveyor registration fee, building design, and construction costs. Infrastructure charges ($20k–$30k per new lot) are the largest single item.',
    excludes_construction: true
  }
}
