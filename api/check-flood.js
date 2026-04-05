/**
 * check-flood.js — Flood overlay check
 *
 * POST /api/check-flood
 * Body: { lat, lng, geom_geojson }
 *
 * Queries flood_overlays in Supabase using the lot polygon.
 * Calculates % of lot covered by each flood planning category.
 *
 * Flood category mapping (BCC City Plan 2014):
 *   FHA_R1         → Category 1 → HIGH risk → RED
 *   FHA_R2A/R2B    → Category 2 → HIGH risk → RED
 *   FHA_R3         → Category 3 → MEDIUM — RED if >50% coverage, AMBER if <50%
 *   FHA_R4/R5      → Category 4-5 → LOW → AMBER (hydraulics report required)
 *   overland_flow  → Any intensity → AMBER
 *
 * Cost/time implications:
 *   Any flood overlay → hydraulics report required ($4,000–$8,000, 6–8 weeks, RPEQ-signed)
 *   High categories → likely RED result (rear lot build form commercially unviable)
 */

const { getClient } = require('./lib/db')

// Categories that trigger RED immediately
const RED_CATEGORIES = ['FHA_R1', 'FHA_R2A', 'FHA_R2B']
// Categories that need coverage check (>50% = RED, any = AMBER)
const COVERAGE_CHECK_CATEGORIES = ['FHA_R3']
// Categories that trigger AMBER regardless of coverage
const AMBER_CATEGORIES = ['FHA_R4', 'FHA_R5']

const HYDRAULICS_COST = '$4,000–$8,000'
const HYDRAULICS_TIME = '6–8 weeks'

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).end()

  const { lat, lng, geom_geojson, area_m2 } = req.body || {}
  if (!lat || !lng) return res.status(400).json({ error: 'lat and lng required' })

  const client = getClient()
  try {
    await client.connect()

    // Use lot polygon if available, otherwise fall back to point
    let lotGeom
    if (geom_geojson) {
      lotGeom = `ST_SetSRID(ST_GeomFromGeoJSON('${JSON.stringify(geom_geojson)}'), 4326)`
    } else {
      // 50m buffer around centroid as fallback
      lotGeom = `ST_Buffer(ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326)::geography, 50)::geometry`
    }

    // Query all overlapping flood areas + coverage %
    const result = await client.query(
      `SELECT
         overlay_type,
         flood_category,
         risk_level,
         CASE
           WHEN ST_Area(${lotGeom}::geography) > 0
           THEN ROUND((ST_Area(ST_Intersection(geometry, ${lotGeom})::geography) /
                       ST_Area(${lotGeom}::geography) * 100)::numeric, 1)
           ELSE 0
         END AS coverage_pct
       FROM flood_overlays
       WHERE ST_Intersects(geometry, ${lotGeom})
       ORDER BY coverage_pct DESC`
    )

    if (result.rows.length === 0) {
      return res.json({
        check: 'flood',
        status: 'NONE',
        flag: 'GREEN',
        message: 'No flood overlay identified on this lot',
        plain_english: 'No flood planning area applies to this lot. No hydraulics report required for subdivision.',
        cost_time_implication: null,
        overlays: [],
        has_river_flood: false,
        has_overland_flow: false,
        highest_category: null
      })
    }

    const overlays = result.rows
    let overallFlag = 'GREEN'
    let status = 'CLEAR'
    let message = ''
    let buildFormFlag = false
    const flags = []

    // Evaluate each overlay
    for (const o of overlays) {
      const cat = o.flood_category
      const pct = parseFloat(o.coverage_pct)

      if (o.overlay_type === 'overland_flow') {
        if (overallFlag !== 'RED') overallFlag = 'AMBER'
        flags.push({
          type: 'overland_flow',
          category: cat,
          risk_level: o.risk_level,
          coverage_pct: pct,
          result: 'AMBER',
          plain_english: `Overland flow (${o.risk_level} intensity) mapped on ${pct}% of this lot. A hydraulics report (${HYDRAULICS_COST}, ${HYDRAULICS_TIME}) will be required to characterise the flow path and propose mitigation.`
        })
      } else if (RED_CATEGORIES.includes(cat)) {
        overallFlag = 'RED'
        buildFormFlag = true
        flags.push({
          type: 'river_flood',
          category: cat,
          risk_level: o.risk_level,
          coverage_pct: pct,
          result: 'RED',
          plain_english: `${cat} flood planning area covers ${pct}% of this lot. This is a high-risk category — subdivision is likely unviable as the rear lot cannot achieve flood immunity without prohibitive earthworks. This was the constraint that killed the 6 Glenheaton Court subdivision in 2024.`
        })
      } else if (COVERAGE_CHECK_CATEGORIES.includes(cat)) {
        if (pct > 50) {
          if (overallFlag !== 'RED') overallFlag = 'AMBER'
          flags.push({
            type: 'river_flood',
            category: cat,
            risk_level: o.risk_level,
            coverage_pct: pct,
            result: 'AMBER',
            plain_english: `${cat} flood planning area covers ${pct}% of this lot. This is significant coverage — a hydraulics report (${HYDRAULICS_COST}, ${HYDRAULICS_TIME}) is required to determine whether the rear lot can achieve flood immunity. Commercially challenging but a qualified hydraulics engineer should confirm before ruling it out.`
          })
        } else {
          if (overallFlag !== 'RED') overallFlag = 'AMBER'
          flags.push({
            type: 'river_flood',
            category: cat,
            risk_level: o.risk_level,
            coverage_pct: pct,
            result: 'AMBER',
            plain_english: `${cat} flood planning area covers ${pct}% of this lot. A hydraulics report (${HYDRAULICS_COST}, ${HYDRAULICS_TIME}) will be required. The engineer will determine whether the rear lot can achieve flood immunity.`
          })
        }
      } else if (AMBER_CATEGORIES.includes(cat)) {
        if (overallFlag !== 'RED') overallFlag = 'AMBER'
        flags.push({
          type: 'river_flood',
          category: cat,
          risk_level: o.risk_level,
          coverage_pct: pct,
          result: 'AMBER',
          plain_english: `${cat} flood planning area (low risk) covers ${pct}% of this lot. A hydraulics report (${HYDRAULICS_COST}, ${HYDRAULICS_TIME}) is likely required to confirm immunity levels.`
        })
      }
    }

    const hasRiver = overlays.some(o => o.overlay_type === 'brisbane_river')
    const hasOverland = overlays.some(o => o.overlay_type === 'overland_flow')
    const highestCat = overlays[0]?.flood_category

    if (overallFlag === 'RED') {
      status = 'HIGH_RISK'
      message = `Flood overlay identified — ${highestCat} category present. Subdivision likely not viable without significant engineering intervention.`
    } else if (overallFlag === 'AMBER') {
      status = 'FLAG'
      message = `Flood overlay identified — hydraulics report (${HYDRAULICS_COST}, ${HYDRAULICS_TIME}) required before subdivision can proceed.`
    }

    return res.json({
      check: 'flood',
      status,
      flag: overallFlag,
      message,
      plain_english: message,
      cost_time_implication: overallFlag !== 'GREEN'
        ? `Hydraulics report required: ${HYDRAULICS_COST}, ${HYDRAULICS_TIME}, must be RPEQ-signed`
        : null,
      build_form_flag: buildFormFlag,
      overlays: flags,
      has_river_flood: hasRiver,
      has_overland_flow: hasOverland,
      highest_category: highestCat
    })
  } catch (err) {
    console.error('check-flood error:', err.message)
    return res.status(500).json({ error: 'Flood check failed', check: 'flood', flag: 'AMBER' })
  } finally {
    await client.end()
  }
}
