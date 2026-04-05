/**
 * check-acidsulfate.js — Acid Sulfate Soils check
 *
 * POST /api/check-acidsulfate
 * Body: { lat, lng }
 *
 * Queries the BCC City Plan 2014 Potential and Actual Acid Sulfate Soils overlay.
 * Acid sulfate soils (ASS) occur in low-lying coastal and riverside areas. When
 * disturbed during earthworks, they release sulfuric acid, triggering environmental
 * obligations and significant cost.
 *
 * Data source: services2.arcgis.com/dEKgZETqwmDAh1rP — BCC City Plan 2014
 * Service: City_Plan_2014_PotentialAndActual_acid_sulfate_soils_overlay
 * Layer 0: Potential and actual acid sulfate soils overlay
 *
 * Note: The Supabase acid_sulfate_overlays table (ZoneIQ Sprint 15) is a
 * future enhancement. Until that table is populated, this check uses the
 * live ArcGIS service as a fallback.
 *
 * Flag logic:
 *   GREEN  — No acid sulfate soils overlay on this lot
 *   AMBER  — Acid sulfate soils overlay present (potential or actual)
 */

const { createClient } = require('@supabase/supabase-js')

const ARCGIS_URL = 'https://services2.arcgis.com/dEKgZETqwmDAh1rP/arcgis/rest/services/City_Plan_2014_PotentialAndActual_acid_sulfate_soils_overlay/FeatureServer/0/query'

async function queryArcGIS(lat, lng) {
  const geom = JSON.stringify({ x: lng, y: lat, spatialReference: { wkid: 4326 } })
  const url = ARCGIS_URL
    + '?geometry=' + encodeURIComponent(geom)
    + '&geometryType=esriGeometryPoint'
    + '&spatialRel=esriSpatialRelIntersects'
    + '&outFields=OBJECTID,CAT_DESC,OVL2_DESC,OVL2_CAT,DESCRIPTION'
    + '&f=json&inSR=4326&outSR=4326'

  const res = await fetch(url, { signal: AbortSignal.timeout(8000) })
  if (!res.ok) throw new Error(`ArcGIS API error: ${res.status}`)
  const data = await res.json()
  if (data.error) throw new Error('ArcGIS: ' + data.error.message)
  return data.features || []
}

async function querySupabase(lat, lng) {
  // Future: query acid_sulfate_overlays table if populated by ZoneIQ Sprint 15
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) return null
  try {
    const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)
    // Check if the table exists and has data
    const { data, error } = await db
      .from('acid_sulfate_overlays')
      .select('id, category, description')
      .limit(1)
    if (error) return null // Table doesn't exist yet
    if (data.length === 0) return null // Table empty — fall through to ArcGIS
    // Table has data — run spatial query (requires PostGIS RPC or raw SQL)
    // TODO: implement ST_Contains query when ZoneIQ Sprint 15 populates this table
    return null
  } catch {
    return null
  }
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', (process.env.ALLOWED_ORIGIN || '*').trim())
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const { lat, lng } = req.body || {}
  if (!lat || !lng) return res.status(400).json({ error: 'lat and lng required', check: 'acidsulfate', flag: 'AMBER' })

  const pLat = parseFloat(lat)
  const pLng = parseFloat(lng)

  try {
    // Try Supabase first (ZoneIQ Sprint 15 table), fall back to ArcGIS
    const supabaseResult = await querySupabase(pLat, pLng)
    const features = supabaseResult ?? await queryArcGIS(pLat, pLng)

    if (features.length > 0) {
      const attrs   = features[0].attributes || {}
      const catDesc = attrs.CAT_DESC || attrs.OVL2_DESC || 'Potential and actual acid sulfate soils'

      return res.json({
        check: 'acidsulfate',
        status: 'PRESENT',
        flag: 'AMBER',
        message: `Acid sulfate soils overlay present: ${catDesc}.`,
        plain_english: 'This lot is within the acid sulfate soils overlay area. Acid sulfate soils occur in low-lying coastal and riverside areas. If earthworks disturb these soils below the water table, they release sulfuric acid — triggering environmental obligations (an acid sulfate soil management plan), construction complications, and significant additional cost. This is relevant for footings, drainage trenches, and any excavation below 1m.',
        cost_time_implication: 'Geotechnical investigation for acid sulfate soils: $2,000–$5,000. Acid sulfate soil management plan (if required): $3,000–$8,000. Can significantly affect earthworks costs.',
        overlay_category: catDesc,
        overlay_raw: attrs,
        data_source: 'BCC City Plan 2014 — Potential and Actual Acid Sulfate Soils overlay'
      })
    }

    return res.json({
      check: 'acidsulfate',
      status: 'CLEAR',
      flag: 'GREEN',
      message: 'No acid sulfate soils overlay identified on this lot.',
      plain_english: 'No acid sulfate soils overlay was identified for this lot. Standard earthworks conditions apply — no special soil investigation required specifically for acid sulfate soils.',
      cost_time_implication: null,
      data_source: 'BCC City Plan 2014 — Potential and Actual Acid Sulfate Soils overlay'
    })

  } catch (err) {
    console.error('[check-acidsulfate] Error:', err.message)
    return res.json({
      check: 'acidsulfate',
      status: 'ERROR',
      flag: 'AMBER',
      message: 'Acid sulfate soils check unavailable — verify manually.',
      plain_english: 'The acid sulfate soils check could not be completed. If your lot is near a creek, river, or low-lying coastal area, request a geotechnical assessment to rule out acid sulfate soils.',
      cost_time_implication: 'Geotechnical investigation: $2,000–$5,000 if required.',
      error: err.message,
      data_source: 'BCC City Plan 2014 — Potential and Actual Acid Sulfate Soils overlay'
    })
  }
}
