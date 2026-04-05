/**
 * check-parcel.js — Parcel boundary lookup
 *
 * GET /api/check-parcel?lat=...&lng=...
 *
 * Returns lot/plan, area, geometry centroid and the data source used.
 *
 * Source priority:
 *   1. BCC addresses (bbox -27.767/-27.238 lat, 152.669/153.317 lng):
 *      Query Supabase subdivide_parcels (bulk-loaded BCC open data)
 *   2. All other QLD addresses (or BCC fallback if Supabase misses):
 *      QLD DCDB live query via ArcGIS REST
 *      Layer: PlanningCadastre/LandParcelPropertyFramework MapServer/4
 *      Prefer parcel_typ = 'B' (base parcel) over easements/strata
 *
 * NOTE: DCDB will be replaced by QSCF (~end May 2026). When migrating:
 *   - New endpoint: TBD (monitor https://www.resources.qld.gov.au/data/datasets)
 *   - Same logic applies — prefer base parcels, return consistent shape
 *
 * Returns:
 *   { lot, plan, lotplan, area_m2, centroid_lat, centroid_lng, source, geometry_wkt? }
 */

const { getClient } = require('./lib/db')

// BCC coverage bounding box
const BCC_BBOX = {
  minLat: -27.767,
  maxLat: -27.238,
  minLng: 152.669,
  maxLng: 153.317
}

// QLD DCDB ArcGIS REST endpoint
// LandParcelPropertyFramework MapServer layer 4 = Current Parcel
const DCDB_URL =
  'https://spatial-gis.information.qld.gov.au/arcgis/rest/services/PlanningCadastre/LandParcelPropertyFramework/MapServer/4/query'

module.exports = async (req, res) => {
  if (req.method !== 'GET') return res.status(405).end()

  const rawLat = req.query?.lat
  const rawLng = req.query?.lng

  if (rawLat === undefined || rawLng === undefined) {
    return res.status(400).json({ error: 'lat and lng query params required' })
  }

  const lat = parseFloat(rawLat)
  const lng = parseFloat(rawLng)

  if (isNaN(lat) || isNaN(lng)) {
    return res.status(400).json({ error: 'lat and lng must be valid numbers' })
  }

  const inBcc =
    lat >= BCC_BBOX.minLat &&
    lat <= BCC_BBOX.maxLat &&
    lng >= BCC_BBOX.minLng &&
    lng <= BCC_BBOX.maxLng

  // ── 1. BCC: Supabase point-in-polygon ────────────────────────────────────────
  if (inBcc) {
    const client = getClient()
    try {
      await client.connect()

      const result = await client.query(
        `SELECT
           lot,
           plan,
           lot || plan AS lotplan,
           area_m2,
           ST_Y(ST_Centroid(geom)) AS centroid_lat,
           ST_X(ST_Centroid(geom)) AS centroid_lng
         FROM subdivide_parcels
         WHERE ST_Contains(
           geom,
           ST_SetSRID(ST_MakePoint($1, $2), 4326)
         )
         LIMIT 1`,
        [lng, lat]
      )

      if (result.rows.length > 0) {
        const row = result.rows[0]
        return res.json({
          lot: row.lot,
          plan: row.plan,
          lotplan: row.lotplan,
          area_m2: row.area_m2 ? Math.round(parseFloat(row.area_m2)) : null,
          centroid_lat: parseFloat(row.centroid_lat),
          centroid_lng: parseFloat(row.centroid_lng),
          source: 'supabase_bcc'
        })
      }

      // BCC bbox but no result in Supabase — fall through to DCDB
    } catch (err) {
      console.error('check-parcel Supabase error:', err.message)
      // Fall through to DCDB on Supabase error
    } finally {
      await client.end()
    }
  }

  // ── 2. DCDB: QLD ArcGIS REST live query ──────────────────────────────────────
  try {
    const params = new URLSearchParams({
      geometry:       `${lng},${lat}`,
      geometryType:   'esriGeometryPoint',
      inSR:           '4326',
      spatialRel:     'esriSpatialRelIntersects',
      outFields:      'lot,plan,lotplan,lot_area,locality,parcel_typ',
      returnGeometry: 'true',
      outSR:          '4326',
      f:              'json'
    })

    const dcdbRes = await fetch(`${DCDB_URL}?${params}`, {
      signal: AbortSignal.timeout(8000)
    })

    if (!dcdbRes.ok) {
      console.error('check-parcel DCDB HTTP error:', dcdbRes.status)
      return res.status(502).json({ error: 'Parcel lookup failed — DCDB unavailable', source: 'dcdb' })
    }

    const dcdbData = await dcdbRes.json()

    if (!dcdbData.features || dcdbData.features.length === 0) {
      return res.status(404).json({
        error: 'No parcel found at this location',
        lat,
        lng,
        source: inBcc ? 'supabase_bcc+dcdb' : 'dcdb'
      })
    }

    // Prefer 'Lot Type Parcel' (base parcel) — filters out easements, strata common property etc
    const features = dcdbData.features
    const baseParcel =
      features.find(f => f.attributes?.parcel_typ === 'Lot Type Parcel') || features[0]
    const attrs = baseParcel.attributes
    const rings = baseParcel.geometry?.rings

    // Compute centroid from polygon rings if geometry present
    let centroid_lat = lat
    let centroid_lng = lng
    if (rings && rings.length > 0) {
      const ring = rings[0]
      const sumLng = ring.reduce((acc, pt) => acc + pt[0], 0) / ring.length
      const sumLat = ring.reduce((acc, pt) => acc + pt[1], 0) / ring.length
      centroid_lng = Math.round(sumLng * 1e7) / 1e7
      centroid_lat = Math.round(sumLat * 1e7) / 1e7
    }

    return res.json({
      lot:          attrs.lot      || null,
      plan:         attrs.plan     || null,
      lotplan:      attrs.lotplan  || null,
      area_m2:      attrs.lot_area ? Math.round(parseFloat(attrs.lot_area)) : null,
      locality:     attrs.locality || null,
      centroid_lat,
      centroid_lng,
      source: inBcc ? 'dcdb_bcc_fallback' : 'dcdb'
    })
  } catch (err) {
    console.error('check-parcel DCDB error:', err.message)
    return res.status(500).json({ error: 'Parcel lookup failed', source: 'dcdb' })
  }
}
