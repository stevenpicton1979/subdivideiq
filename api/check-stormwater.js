/**
 * check-stormwater.js — Stormwater infrastructure proximity check
 *
 * POST /api/check-stormwater
 * Body: { lat, lng }
 *
 * Queries subdivide_sw_pipes and subdivide_sw_drains in Supabase PostGIS.
 *
 * Pipe proximity logic (nearest pipe to lot centroid):
 *   < 30m   → GREEN  (drainage connection viable, standard cost)
 *   30–80m  → AMBER  (longer connection, higher cost)
 *   > 80m   → AMBER/RED (significant connection cost, confirm with hydraulics)
 *
 * Overland flow proximity (FLOODWAY/SWALE/EARTH DRAIN drain types):
 *   Within 100m → AMBER (overland flow path nearby — drainage design required)
 *
 * Note: Supabase only contains pipes/drains within the loaded area.
 * Until full Brisbane load is complete, UNKNOWN is returned for unloaded areas.
 */

const { getClient } = require('./lib/db')

// Drain types used as overland flow proxies (see load-sw-drains.js notes)
const FLOW_PATH_TYPES = ['FLOODWAY', 'SWALE', 'EARTH DRAIN', 'UNFORMED OPEN DRAIN']

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).end()

  const { lat, lng } = req.body || {}
  if (!lat || !lng) return res.status(400).json({ error: 'lat and lng required' })

  const client = getClient()
  try {
    await client.connect()

    const pt = `ST_SetSRID(ST_MakePoint($1, $2), 4326)`

    // Nearest stormwater pipe (within 200m)
    const pipeResult = await client.query(
      `SELECT
         pipe_id,
         material,
         diameter_mm,
         ROUND(ST_Distance(${pt}::geography, geom::geography)::numeric, 1) AS dist_m
       FROM subdivide_sw_pipes
       WHERE ST_DWithin(${pt}::geography, geom::geography, 200)
       ORDER BY dist_m ASC
       LIMIT 5`,
      [lng, lat]
    )

    // Nearest overland flow path drain (within 200m)
    const drainResult = await client.query(
      `SELECT
         drain_id,
         drain_type,
         ROUND(ST_Distance(${pt}::geography, geom::geography)::numeric, 1) AS dist_m
       FROM subdivide_sw_drains
       WHERE ST_DWithin(${pt}::geography, geom::geography, 200)
         AND drain_type = ANY($3::text[])
       ORDER BY dist_m ASC
       LIMIT 3`,
      [lng, lat, FLOW_PATH_TYPES]
    )

    // Check if this area has any pipe data loaded at all (within 500m)
    const coverageCheck = await client.query(
      `SELECT COUNT(*) AS cnt FROM subdivide_sw_pipes
       WHERE ST_DWithin(${pt}::geography, geom::geography, 500)`,
      [lng, lat]
    )
    const hasData = parseInt(coverageCheck.rows[0].cnt) > 0

    if (!hasData) {
      return res.json({
        check: 'stormwater',
        flag: 'GREY',
        status: 'NOT_AVAILABLE',
        message: 'Stormwater infrastructure data not available for this council area.',
        plain_english: 'We don\'t currently hold stormwater pipe data for this area. This check has been skipped — it does not affect your GREEN/AMBER/RED result.',
        cost_time_implication: null,
        nearest_pipe: null,
        nearest_flow_path: null
      })
    }

    // Evaluate pipe proximity
    let pipeFlag = 'GREEN'
    let pipeStatus = 'NONE'
    let pipeMessage = ''
    let nearestPipe = null

    if (pipeResult.rows.length > 0) {
      nearestPipe = pipeResult.rows[0]
      const dist = parseFloat(nearestPipe.dist_m)
      const diamStr = nearestPipe.diameter_mm ? `${nearestPipe.diameter_mm}mm` : 'unknown diameter'

      if (dist < 30) {
        pipeFlag = 'GREEN'
        pipeStatus = 'NEARBY'
        pipeMessage = `Stormwater pipe (${diamStr}) located ${dist}m away. Connection is straightforward — standard drainage connection cost applies ($5,000–$15,000).`
      } else if (dist <= 80) {
        pipeFlag = 'AMBER'
        pipeStatus = 'MODERATE_DISTANCE'
        pipeMessage = `Nearest stormwater pipe (${diamStr}) is ${dist}m away. Connection will require a longer run — budget $15,000–$30,000 for connection works.`
      } else {
        pipeFlag = 'AMBER'
        pipeStatus = 'DISTANT'
        pipeMessage = `Nearest stormwater pipe (${diamStr}) is ${dist}m away. This is a significant connection distance — confirm feasibility and cost with a hydraulics engineer. Budget $30,000+.`
      }
    } else {
      pipeFlag = 'AMBER'
      pipeStatus = 'NOT_FOUND'
      pipeMessage = 'No stormwater pipe found within 200m. Connection may be challenging — consult a hydraulics engineer.'
    }

    // Evaluate overland flow proximity
    let flowFlag = 'GREEN'
    let flowStatus = 'NONE'
    let flowMessage = ''
    let nearestFlowPath = null

    if (drainResult.rows.length > 0) {
      nearestFlowPath = drainResult.rows[0]
      const dist = parseFloat(nearestFlowPath.dist_m)
      const type = nearestFlowPath.drain_type

      if (dist <= 100) {
        flowFlag = 'AMBER'
        flowStatus = 'FLOW_PATH_NEARBY'
        flowMessage = `${type} (overland flow path proxy) mapped ${dist}m from this lot. The drainage design for subdivision must account for this flow path — hydraulics engineer required.`
      }
    }

    // Combined flag
    const flags = [pipeFlag, flowFlag]
    const overallFlag = flags.includes('RED') ? 'RED' : flags.includes('AMBER') ? 'AMBER' : 'GREEN'
    const overallMessage = [pipeMessage, flowMessage].filter(Boolean).join(' | ')

    return res.json({
      check: 'stormwater',
      status: pipeStatus,
      flag: overallFlag,
      message: overallMessage,
      plain_english: overallMessage,
      cost_time_implication: overallFlag !== 'GREEN'
        ? 'Drainage connection: $5,000–$30,000+. Hydraulics engineer may be required ($4,000–$8,000).'
        : null,
      pipe_flag: pipeFlag,
      pipe_status: pipeStatus,
      pipe_message: pipeMessage,
      flow_flag: flowFlag,
      flow_status: flowStatus,
      flow_message: flowMessage,
      nearest_pipe: nearestPipe ? {
        pipe_id: nearestPipe.pipe_id,
        diameter_mm: nearestPipe.diameter_mm,
        material: nearestPipe.material,
        dist_m: parseFloat(nearestPipe.dist_m)
      } : null,
      nearest_flow_path: nearestFlowPath ? {
        drain_id: nearestFlowPath.drain_id,
        drain_type: nearestFlowPath.drain_type,
        dist_m: parseFloat(nearestFlowPath.dist_m)
      } : null,
      nearby_pipes: pipeResult.rows.map(r => ({
        pipe_id: r.pipe_id,
        diameter_mm: r.diameter_mm,
        material: r.material,
        dist_m: parseFloat(r.dist_m)
      }))
    })
  } catch (err) {
    console.error('check-stormwater error:', err.message)
    return res.status(500).json({ error: 'Stormwater check failed', check: 'stormwater', flag: 'AMBER' })
  } finally {
    await client.end()
  }
}
