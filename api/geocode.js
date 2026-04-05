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

    // Query Supabase PostGIS for matching parcel
    try {
      const parcel = await lookupParcel(resolvedLat, resolvedLng)
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
