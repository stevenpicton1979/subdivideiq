/**
 * geocode.js — Address geocoding and parcel lookup for SubdivideIQ
 *
 * GET  /api/geocode?address=...&suggest=true  → address autocomplete suggestions
 * POST /api/geocode { address, lat, lng }      → parcel lookup
 *
 * Flow:
 *   1. Geocode address via Mapbox → lat/lng
 *   2. PostGIS query on subdivide_parcels to find matching lot
 *   3. Return: { lot, plan, area_m2, geom_geojson, centroid_lat, centroid_lng }
 *
 * Mapbox token: MAPBOX_TOKEN env var
 * Supabase: fzykfxesznyiigoyeyed
 */

const { Client } = require('pg')

const MAPBOX_TOKEN = process.env.MAPBOX_TOKEN
const DATABASE_URL = process.env.DATABASE_URL
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://fzykfxesznyiigoyeyed.supabase.co'
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY

// BCC coverage bounding box (partial load — Carindale area only)
const BCC_BBOX = { minLat: -27.767, maxLat: -27.238, minLng: 152.669, maxLng: 153.317 }

// QLD DCDB — live query for all non-BCC addresses (and BCC fallback)
const DCDB_URL =
  'https://spatial-gis.information.qld.gov.au/arcgis/rest/services/PlanningCadastre/LandParcelPropertyFramework/MapServer/4/query'

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', (process.env.ALLOWED_ORIGIN || '*').trim())
  res.setHeader('Content-Type', 'application/json')

  if (req.method === 'OPTIONS') return res.status(200).end()

  // GET: address autocomplete suggestions
  if (req.method === 'GET') {
    const { address, suggest } = req.query
    if (!address || suggest !== 'true') {
      return res.status(400).json({ error: 'address and suggest=true required' })
    }

    try {
      const suggestions = await geocodeSuggest(address)
      return res.json({ suggestions })
    } catch (err) {
      console.error('Geocode suggest error:', err.message)
      return res.status(500).json({ error: 'Geocode failed', suggestions: [] })
    }
  }

  // POST: full parcel lookup
  if (req.method === 'POST') {
    const { address, lat, lng } = req.body || {}
    if (!address) {
      return res.status(400).json({ error: 'address required' })
    }

    let resolvedLat = lat
    let resolvedLng = lng

    // Geocode if lat/lng not provided
    if (!resolvedLat || !resolvedLng) {
      try {
        const geo = await geocodeAddress(address)
        if (!geo) return res.status(404).json({ error: 'Address not found', lot: null })
        resolvedLat = geo.lat
        resolvedLng = geo.lng
      } catch (err) {
        console.error('Geocode error:', err.message)
        return res.status(500).json({ error: 'Geocode failed' })
      }
    }

    // Route: BCC bbox → Supabase, otherwise → DCDB live API
    const inBcc =
      resolvedLat >= BCC_BBOX.minLat && resolvedLat <= BCC_BBOX.maxLat &&
      resolvedLng >= BCC_BBOX.minLng && resolvedLng <= BCC_BBOX.maxLng

    try {
      let parcel = null

      if (inBcc) {
        parcel = await lookupParcel(resolvedLat, resolvedLng)
      }

      // Non-BCC, or BCC with no Supabase result → DCDB
      if (!parcel) {
        parcel = await lookupParcelDcdb(resolvedLat, resolvedLng)
      }

      if (!parcel) {
        return res.status(404).json({
          error: 'No parcel found at this location',
          lot: null,
          lat: resolvedLat,
          lng: resolvedLng
        })
      }
      return res.json(parcel)
    } catch (err) {
      console.error('Parcel lookup error:', err.message)
      return res.status(500).json({ error: 'Parcel lookup failed' })
    }
  }

  return res.status(405).end()
}

/**
 * Autocomplete suggestions via Mapbox Geocoding API
 * Returns array of { place_name, lat, lng }
 */
async function geocodeSuggest(query) {
  if (!MAPBOX_TOKEN) {
    // Fallback: return empty (frontend can still accept manual entry)
    return []
  }

  const encoded = encodeURIComponent(query)
  const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encoded}.json` +
    `?access_token=${MAPBOX_TOKEN}` +
    `&country=AU` +
    `&bbox=152.6,-28.2,153.6,-26.8` + // Brisbane/SEQ bounding box
    `&types=address` +
    `&limit=5`

  const res = await fetch(url, { signal: AbortSignal.timeout(5000) })
  if (!res.ok) throw new Error(`Mapbox error: ${res.status}`)

  const data = await res.json()
  return (data.features || []).map(f => ({
    place_name: f.place_name,
    lat: f.center[1],
    lng: f.center[0]
  }))
}

/**
 * Geocode a full address to lat/lng via Mapbox
 */
async function geocodeAddress(address) {
  if (!MAPBOX_TOKEN) return null

  const encoded = encodeURIComponent(address)
  const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encoded}.json` +
    `?access_token=${MAPBOX_TOKEN}` +
    `&country=AU` +
    `&limit=1`

  const res = await fetch(url, { signal: AbortSignal.timeout(5000) })
  if (!res.ok) throw new Error(`Mapbox error: ${res.status}`)

  const data = await res.json()
  if (!data.features || data.features.length === 0) return null

  const f = data.features[0]
  return { lat: f.center[1], lng: f.center[0] }
}

/**
 * Live parcel lookup via QLD DCDB ArcGIS REST API
 * Used for all non-BCC addresses (Gold Coast, Moreton Bay, Sunshine Coast etc)
 * and as a fallback when Supabase returns no result for a BCC address
 */
async function lookupParcelDcdb(lat, lng) {
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
  if (!dcdbRes.ok) throw new Error(`DCDB HTTP error: ${dcdbRes.status}`)

  const data = await dcdbRes.json()
  if (!data.features || data.features.length === 0) return null

  // Prefer 'Lot Type Parcel' (base parcel) over easements/strata
  const features = data.features
  const base = features.find(f => f.attributes?.parcel_typ === 'Lot Type Parcel') || features[0]
  const attrs = base.attributes
  const rings = base.geometry?.rings

  // Compute centroid and build GeoJSON from polygon rings
  let centroid_lat = lat
  let centroid_lng = lng
  let geom_geojson = null

  if (rings && rings.length > 0) {
    const ring = rings[0]
    centroid_lng = Math.round(ring.reduce((s, p) => s + p[0], 0) / ring.length * 1e7) / 1e7
    centroid_lat = Math.round(ring.reduce((s, p) => s + p[1], 0) / ring.length * 1e7) / 1e7
    geom_geojson = { type: 'Polygon', coordinates: rings }
  }

  return {
    lot:          attrs.lot    || null,
    plan:         attrs.plan   || null,
    address:      attrs.locality || null,
    area_m2:      attrs.lot_area ? parseFloat(attrs.lot_area) : null,
    geom_geojson,
    centroid_lat,
    centroid_lng
  }
}

/**
 * Find the parcel at a given lat/lng using PostGIS ST_Contains
 * Falls back to nearest parcel within 50m if no exact match
 */
async function lookupParcel(lat, lng) {
  const client = new Client({
    connectionString: DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  })

  try {
    await client.connect()
    const point = `ST_SetSRID(ST_MakePoint($1, $2), 4326)`

    // Try exact match (point inside polygon)
    let result = await client.query(
      `SELECT
         lot,
         plan,
         address,
         area_m2,
         ST_AsGeoJSON(geom)::json AS geom_geojson,
         ST_Y(ST_Centroid(geom::geometry)) AS centroid_lat,
         ST_X(ST_Centroid(geom::geometry)) AS centroid_lng
       FROM subdivide_parcels
       WHERE ST_Contains(geom::geometry, ${point}::geometry)
         AND area_m2 > 100
       LIMIT 1`,
      [lng, lat]
    )

    // Fallback: nearest within 50m
    if (result.rows.length === 0) {
      result = await client.query(
        `SELECT
           lot,
           plan,
           address,
           area_m2,
           ST_AsGeoJSON(geom)::json AS geom_geojson,
           ST_Y(ST_Centroid(geom::geometry)) AS centroid_lat,
           ST_X(ST_Centroid(geom::geometry)) AS centroid_lng,
           ST_Distance(${point}::geography, geom::geography) AS dist_m
         FROM subdivide_parcels
         WHERE ST_DWithin(${point}::geography, geom::geography, 50)
           AND area_m2 > 100
         ORDER BY dist_m ASC
         LIMIT 1`,
        [lng, lat]
      )
    }

    if (result.rows.length === 0) return null

    const r = result.rows[0]
    return {
      lot: r.lot,
      plan: r.plan,
      address: r.address,
      area_m2: parseFloat(r.area_m2),
      geom_geojson: r.geom_geojson,
      centroid_lat: parseFloat(r.centroid_lat),
      centroid_lng: parseFloat(r.centroid_lng)
    }
  } finally {
    await client.end()
  }
}
