/**
 * check-elevation.js — Slope and elevation check via QLD ArcGIS ImageServer
 *
 * POST /api/check-elevation
 * Body: { lat, lng, geom_geojson, flood_min_immunity_m }
 *
 * Samples 9 elevation points across the lot bounding box (3x3 grid).
 * Queries: https://spatial-img.information.qld.gov.au/arcgis/rest/services/Elevation/QldDem/ImageServer/identify
 *
 * Slope classification:
 *   FLAT     < 2%   → GREEN
 *   MODERATE 2–10%  → AMBER (earthworks likely, cost flagged)
 *   STEEP    > 10%  → AMBER/RED (significant earthworks, possibly unviable)
 *
 * Flood immunity signal:
 *   If flood overlay present and min_elevation < (flood_immunity_level + 0.5m)
 *   → flag "groundworks unlikely to achieve flood immunity — stilts likely required"
 */

const ELEVATION_API = 'https://spatial-img.information.qld.gov.au/arcgis/rest/services/Elevation/QldDem/ImageServer/identify'

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).end()

  const { lat, lng, geom_geojson, flood_min_immunity_m } = req.body || {}
  if (!lat || !lng) return res.status(400).json({ error: 'lat and lng required' })

  try {
    const points = buildSampleGrid(lat, lng, geom_geojson)
    const elevations = await fetchElevations(points)

    const validElevs = elevations.filter(e => e !== null)
    if (validElevs.length === 0) {
      return res.json({
        check: 'elevation',
        status: 'UNKNOWN',
        flag: 'AMBER',
        message: 'Elevation data unavailable for this location',
        plain_english: 'Could not retrieve elevation data. Assume moderate earthworks cost.',
        elevation_points: elevations,
        min_elevation_m: null,
        max_elevation_m: null,
        slope_pct: null,
        slope_class: null
      })
    }

    const minElev = Math.min(...validElevs)
    const maxElev = Math.max(...validElevs)

    // Estimate lot width from grid spacing
    const lotWidthEst = estimateLotWidth(lat, lng, geom_geojson)
    const elevRange = maxElev - minElev
    const slopePct = lotWidthEst > 0 ? (elevRange / lotWidthEst) * 100 : 0

    let slopeClass, flag, status, message, costImplication

    if (slopePct < 2) {
      slopeClass = 'FLAT'
      flag = 'GREEN'
      status = 'FLAT'
      message = `Lot is essentially flat (estimated slope ${slopePct.toFixed(1)}%). Minimal earthworks required.`
      costImplication = null
    } else if (slopePct <= 10) {
      slopeClass = 'MODERATE'
      flag = 'AMBER'
      status = 'MODERATE_SLOPE'
      message = `Moderate slope detected (estimated ${slopePct.toFixed(1)}%). Earthworks will be required for the rear lot — budget $15,000–$50,000 depending on extent.`
      costImplication = 'Earthworks: $15,000–$50,000'
    } else {
      slopeClass = 'STEEP'
      flag = 'AMBER'
      status = 'STEEP_SLOPE'
      message = `Steep slope detected (estimated ${slopePct.toFixed(1)}%). Significant earthworks required — a geotechnical report may also be needed. Budget $50,000+ for site preparation.`
      costImplication = 'Earthworks: $50,000+. Geotechnical report likely required ($3,000–$6,000).'
    }

    // Flood immunity signal
    let stiltsFlag = false
    let stiltsMessage = null
    if (flood_min_immunity_m !== undefined && flood_min_immunity_m !== null && minElev !== null) {
      const immunityRequired = parseFloat(flood_min_immunity_m)
      if (!isNaN(immunityRequired)) {
        const floorLevelRequired = immunityRequired + 0.5 // 500mm freeboard
        if (minElev < floorLevelRequired) {
          stiltsFlag = true
          stiltsMessage = `Minimum lot elevation (${minElev.toFixed(2)}m AHD) is below the required flood immunity floor level (${floorLevelRequired.toFixed(2)}m AHD). Groundworks are unlikely to raise the site sufficiently — raised construction (stilts) is likely required. This was the constraint on 6 Glenheaton Court extension.`
          if (flag === 'GREEN') flag = 'AMBER'
        }
      }
    }

    return res.json({
      check: 'elevation',
      status,
      flag,
      message,
      plain_english: message,
      cost_time_implication: costImplication,
      min_elevation_m: parseFloat(minElev.toFixed(2)),
      max_elevation_m: parseFloat(maxElev.toFixed(2)),
      elevation_range_m: parseFloat(elevRange.toFixed(2)),
      slope_pct: parseFloat(slopePct.toFixed(1)),
      slope_class: slopeClass,
      elevation_points: elevations,
      stilts_flag: stiltsFlag,
      stilts_message: stiltsMessage
    })
  } catch (err) {
    console.error('check-elevation error:', err.message)
    return res.status(500).json({ error: 'Elevation check failed', check: 'elevation', flag: 'AMBER' })
  }
}

/**
 * Build 9-point 3x3 sample grid across the lot bounding box.
 * If geom_geojson provided, use its bbox. Otherwise estimate from centroid.
 */
function buildSampleGrid(lat, lng, geom_geojson) {
  let minLng, maxLng, minLat, maxLat

  if (geom_geojson) {
    const bbox = computeBbox(geom_geojson)
    if (bbox) {
      ;[minLng, minLat, maxLng, maxLat] = bbox
    }
  }

  if (!minLng) {
    // Fallback: ~50m box around centroid
    const delta = 0.0004
    minLng = lng - delta; maxLng = lng + delta
    minLat = lat - delta; maxLat = lat + delta
  }

  const points = []
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 3; col++) {
      const pLng = minLng + (maxLng - minLng) * (col / 2)
      const pLat = minLat + (maxLat - minLat) * (row / 2)
      points.push({ lng: pLng, lat: pLat })
    }
  }
  return points
}

function computeBbox(geom_geojson) {
  try {
    let coords = []
    const geom = geom_geojson.type === 'Feature' ? geom_geojson.geometry : geom_geojson
    function extractCoords(c) {
      if (typeof c[0] === 'number') { coords.push(c); return }
      c.forEach(extractCoords)
    }
    extractCoords(geom.coordinates)
    if (!coords.length) return null
    const lngs = coords.map(c => c[0])
    const lats = coords.map(c => c[1])
    return [Math.min(...lngs), Math.min(...lats), Math.max(...lngs), Math.max(...lats)]
  } catch {
    return null
  }
}

function estimateLotWidth(lat, lng, geom_geojson) {
  const bbox = geom_geojson ? computeBbox(geom_geojson) : null
  if (!bbox) return 30 // default 30m lot width
  const [minLng, minLat, maxLng, maxLat] = bbox
  // Convert degree difference to approximate metres
  const widthM = Math.abs(maxLng - minLng) * 111320 * Math.cos(lat * Math.PI / 180)
  const heightM = Math.abs(maxLat - minLat) * 110540
  return Math.min(widthM, heightM) // use shorter dimension as width
}

/**
 * Fetch elevation for each point from QLD ArcGIS ImageServer.
 * Returns array of elevation values (null if NoData/error).
 */
async function fetchElevations(points) {
  const results = await Promise.allSettled(
    points.map(p => fetchOneElevation(p.lat, p.lng))
  )
  return results.map(r => r.status === 'fulfilled' ? r.value : null)
}

async function fetchOneElevation(lat, lng) {
  const geomParam = encodeURIComponent(JSON.stringify({
    x: lng, y: lat,
    spatialReference: { wkid: 4326 }
  }))
  const url = `${ELEVATION_API}?geometry=${geomParam}&geometryType=esriGeometryPoint&returnGeometry=false&returnCatalogItems=false&f=json`

  const res = await fetch(url, { signal: AbortSignal.timeout(6000) })
  if (!res.ok) return null

  const data = await res.json()
  if (!data.value || data.value === 'NoData') return null
  const val = parseFloat(data.value)
  return isNaN(val) ? null : val
}
