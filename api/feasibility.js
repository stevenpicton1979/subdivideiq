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

  const { lat, lng, geom_geojson, area_m2, suburb } = req.body || {}
  if (!lat || !lng) return res.status(400).json({ error: 'lat and lng required' })

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
      runCheck('check-infrastructure',{ lat, lng, suburb }, req),
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

    // Aggregate flags
    const flags = Object.values(checks)
      .map(c => c?.flag)
      .filter(Boolean)

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

    return res.json({
      overall: {
        flag: overallFlag,
        status: overallStatus,
        summary: overallSummary,
        red_count: redCount,
        amber_count: amberCount,
        green_count: flags.filter(f => f === 'GREEN').length
      },
      checks,
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
 * Build a plain-English consultant sequence for the "what to do next" section.
 */
function buildConsultantSequence(checks, overallFlag) {
  const steps = []

  if (overallFlag === 'RED') {
    steps.push({
      step: 1,
      who: 'Town planner',
      why: 'Confirm whether the red flag constraints are absolute blockers or can be engineered around',
      cost: '$500–$1,500 for an initial feasibility opinion',
      urgency: 'Do this before spending anything else'
    })
    return steps
  }

  steps.push({
    step: 1,
    who: 'Town planner',
    why: 'Confirm zone compliance, overlay implications, and the best split configuration for your lot',
    cost: '$1,500–$3,000',
    urgency: 'Start here — sets direction for everything else'
  })

  if (checks.flood?.flag !== 'GREEN') {
    steps.push({
      step: steps.length + 1,
      who: 'Hydraulics engineer (RPEQ-signed)',
      why: 'Required for any lot with flood overlay — assesses immunity levels and drainage requirements',
      cost: '$4,000–$8,000',
      urgency: 'After town planner confirms overall viability'
    })
  }

  steps.push({
    step: steps.length + 1,
    who: 'Land surveyor (cadastral)',
    why: 'Prepares the plan of subdivision and lot boundaries for lodgement',
    cost: '$2,000–$4,000',
    urgency: 'After town planner confirms split configuration'
  })

  if (checks.elevation?.slope_class === 'STEEP') {
    steps.push({
      step: steps.length + 1,
      who: 'Geotechnical engineer',
      why: 'Steep slope requires soil stability assessment for earthworks and footings',
      cost: '$3,000–$6,000',
      urgency: 'If proceeding on a steep lot'
    })
  }

  steps.push({
    step: steps.length + 1,
    who: 'Development application (DA)',
    why: 'Formal council approval for the subdivision',
    cost: '$3,000–$8,000 (council fees + planner preparation)',
    urgency: 'After all technical reports are complete'
  })

  const infraCharge = checks.infrastructure?.estimated_charge_per_lot
    ? '$' + checks.infrastructure.estimated_charge_per_lot.toLocaleString('en-AU')
    : '$28,000–$32,000'
  steps.push({
    step: steps.length + 1,
    who: 'Infrastructure charges (BCC)',
    why: 'BCC levies infrastructure charges for each new lot created — this is a mandatory cost, not optional',
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
  if (checks.stormwater?.pipe_flag === 'AMBER') {
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
