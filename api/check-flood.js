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
 *
 * Fallback for addresses outside the 7 covered councils:
 *   Queries the QLD Floodplain Assessment Overlay (QFAO) via ArcGIS REST API.
 *   QFAO is a state-level overlay — less granular than council data but better than nothing.
 */

const { getClient } = require('./lib/db')

// Combined bounding box covering all 7 councils with Supabase flood data:
// Brisbane, Gold Coast, Moreton Bay, Sunshine Coast, Ipswich, Logan, Redland
const SEQ_COVERAGE_BBOX = {
  minLat: -28.25,
  maxLat: -26.25,
  minLng: 152.30,
  maxLng: 153.65
}

// Queensland Floodplain Assessment Overlay — state-level, queried live for non-SEQ addresses
// ArcGIS Online org: V70KGACJ4H63jKE8, layer ID 42 (confirmed April 2026)
const QFAO_URL =
  'https://services3.arcgis.com/V70KGACJ4H63jKE8/arcgis/rest/services/Floodplain_Assessment_Overlay_v2_QRA1/FeatureServer/42/query'

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

  // Route: addresses outside the 7 covered councils → QFAO state-level fallback
  const inSeq =
    lat >= SEQ_COVERAGE_BBOX.minLat && lat <= SEQ_COVERAGE_BBOX.maxLat &&
    lng >= SEQ_COVERAGE_BBOX.minLng && lng <= SEQ_COVERAGE_BBOX.maxLng

  if (!inSeq) {
    return checkFloodQfao(lat, lng, res)
  }

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
        plain_english: 'No flood planning area applies to this lot. No hydraulics report required for flood reasons. Note: flood overlay was the constraint that killed the 6 Glenheaton Court subdivision — this lot does not have that problem.',
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

/**
 * QFAO fallback — used for addresses outside the 7 SEQ councils.
 * Queries the QLD state-level Floodplain Assessment Overlay at runtime.
 * Less granular than council data — indicates potential flood risk only.
 */
async function checkFloodQfao(lat, lng, res) {
  const QFAO_DISCLAIMER =
    'This flood assessment is based on the Queensland state-level floodplain overlay and is not property-specific. Contact your local council for detailed flood mapping.'

  try {
    const params = new URLSearchParams({
      geometry:     `${lng},${lat}`,
      geometryType: 'esriGeometryPoint',
      spatialRel:   'esriSpatialRelIntersects',
      inSR:         '4326',
      outFields:    'SUB_NAME,SUB_NUMBER,QRA_SUPPLY',
      f:            'json'
    })

    const qfaoRes = await fetch(`${QFAO_URL}?${params}`, {
      signal: AbortSignal.timeout(8000)
    })

    if (!qfaoRes.ok) {
      console.error('check-flood QFAO HTTP error:', qfaoRes.status)
      return res.status(502).json({
        error: 'Flood check failed — state overlay unavailable',
        check: 'flood',
        flag: 'AMBER'
      })
    }

    const data = await qfaoRes.json()

    if (!data.features || data.features.length === 0) {
      return res.json({
        check: 'flood',
        status: 'NO_STATE_FLOOD_OVERLAY',
        flag: 'GREEN',
        message: 'No state floodplain overlay identified at this location.',
        plain_english: `No Queensland floodplain assessment overlay applies to this location. ${QFAO_DISCLAIMER}`,
        cost_time_implication: null,
        overlays: [],
        has_river_flood: false,
        has_overland_flow: false,
        highest_category: null,
        source: 'qfao',
        disclaimer: QFAO_DISCLAIMER
      })
    }

    // One or more QFAO polygons intersect — flag as possible flood risk
    const feature = data.features[0].attributes
    const subName   = feature.SUB_NAME   || null
    const subNumber = feature.SUB_NUMBER || null

    const nameStr = subName ? ` (${subName}${subNumber ? ' #' + subNumber : ''})` : ''
    const message = `Queensland state floodplain overlay${nameStr} intersects this location. Contact your local council for property-level flood mapping detail.`

    return res.json({
      check: 'flood',
      status: 'FLOOD_RISK_POSSIBLE',
      flag: 'AMBER',
      message,
      plain_english: `${message} ${QFAO_DISCLAIMER}`,
      cost_time_implication: 'Contact local council for detailed flood mapping. A hydraulics report ($4,000–$8,000) may be required before subdivision can proceed.',
      overlays: data.features.map(f => ({
        sub_name:   f.attributes.SUB_NAME   || null,
        sub_number: f.attributes.SUB_NUMBER || null,
        qra_supply: f.attributes.QRA_SUPPLY || null
      })),
      has_river_flood: true,
      has_overland_flow: false,
      highest_category: null,
      source: 'qfao',
      disclaimer: QFAO_DISCLAIMER
    })
  } catch (err) {
    console.error('check-flood QFAO error:', err.message)
    return res.status(500).json({ error: 'Flood check failed', check: 'flood', flag: 'AMBER' })
  }
}
