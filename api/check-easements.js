/**
 * check-easements.js — High Voltage Powerline Easement check
 *
 * POST /api/check-easements
 * Body: { lat, lng, geom_geojson }
 *
 * Queries BCC City Plan "Regional Infrastructure Corridors" overlay for
 * major electricity infrastructure high voltage powerline easements.
 *
 * Data source: services2.arcgis.com/dEKgZETqwmDAh1rP — BCC City Plan 2014
 * Layer: Regional_infrastructure_corridors_and_substations_overlay_High_voltage_easements
 *
 * Search strategy:
 *   1. Point-in-polygon: does the lot centroid sit within a declared easement? → RED
 *   2. Buffer check: is any easement within 50m of the lot centroid? → AMBER
 *   3. No easement found: → GREEN
 *
 * Flag logic:
 *   RED    — Lot centroid intersects a high voltage easement
 *   AMBER  — Easement within 50m — may affect rear lot or battleaxe access
 *   GREEN  — No major electricity easement found within 50m
 *
 * Note: This covers BCC "major electricity infrastructure" easements only.
 * Distribution-level easements (underground cables, substations) are not
 * included. A cadastral surveyor should confirm all easements on title.
 */

const ARCGIS_BASE = 'https://services2.arcgis.com/dEKgZETqwmDAh1rP/arcgis/rest/services'
const SERVICE     = 'Regional_infrastructure_corridors_and_substations_overlay_High_voltage_easements'
const LAYER_ID    = 0

async function queryEasements(lat, lng, bufferMetres) {
  const geom = JSON.stringify({ x: lng, y: lat, spatialReference: { wkid: 4326 } })
  const url = [
    `${ARCGIS_BASE}/${SERVICE}/FeatureServer/${LAYER_ID}/query`,
    `?geometry=${encodeURIComponent(geom)}`,
    `&geometryType=esriGeometryPoint`,
    `&spatialRel=esriSpatialRelIntersects`,
    `&outFields=OBJECTID,OVL2_DESC,OVL2_CAT,Shape__Area,Shape__Length`,
    `&f=json`,
    `&inSR=4326`,
    `&outSR=4326`,
    bufferMetres ? `&distance=${bufferMetres}&units=esriSRUnit_Meter` : ''
  ].join('')

  const res = await fetch(url, { signal: AbortSignal.timeout(8000) })
  if (!res.ok) throw new Error(`ArcGIS API error: ${res.status}`)
  const data = await res.json()
  if (data.error) throw new Error('ArcGIS: ' + data.error.message)
  return data.features || []
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', process.env.ALLOWED_ORIGIN || '*')
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const { lat, lng } = req.body || {}
  if (!lat || !lng) return res.status(400).json({ error: 'lat and lng required', check: 'easements', flag: 'AMBER' })

  const pLat = parseFloat(lat)
  const pLng = parseFloat(lng)

  try {
    // 1. Point-in-polygon (centroid intersects easement)
    const direct = await queryEasements(pLat, pLng, 0)
    if (direct.length > 0) {
      const desc = direct[0].attributes?.OVL2_DESC || 'High voltage powerline easement'
      return res.json({
        check: 'easements',
        status: 'INTERSECTS',
        flag: 'RED',
        message: `High voltage powerline easement crosses this lot. Significant constraint.`,
        plain_english: `A major electricity infrastructure easement (${desc}) crosses or runs through this lot. Easements restrict what can be built within them — a rear lot or battleaxe driveway may be completely unbuildable depending on easement location. A cadastral surveyor must confirm the easement boundaries before any subdivision design.`,
        cost_time_implication: 'Cadastral surveyor ($2,000–$4,000) required to map easement boundaries. Subdivision may not be viable if the easement bisects the rear lot area.',
        easement_count: direct.length,
        easement_type: desc,
        data_source: 'BCC City Plan 2014 — Regional Infrastructure Corridors overlay'
      })
    }

    // 2. Buffer check — within 50m
    const nearby = await queryEasements(pLat, pLng, 50)
    if (nearby.length > 0) {
      const desc = nearby[0].attributes?.OVL2_DESC || 'High voltage powerline easement'
      return res.json({
        check: 'easements',
        status: 'NEARBY',
        flag: 'AMBER',
        message: `High voltage easement found within 50m. May affect rear lot or battleaxe access.`,
        plain_english: `A major electricity infrastructure easement is within 50m of this lot boundary. Depending on the easement's position, it could affect the viability of a rear lot or battleaxe driveway. A cadastral surveyor should confirm whether the easement encroaches on the lot or planned subdivision area.`,
        cost_time_implication: 'Cadastral surveyor review recommended ($2,000–$4,000) before committing to a subdivision design.',
        easement_count: nearby.length,
        easement_type: desc,
        data_source: 'BCC City Plan 2014 — Regional Infrastructure Corridors overlay'
      })
    }

    // 3. No easement found
    return res.json({
      check: 'easements',
      status: 'CLEAR',
      flag: 'GREEN',
      message: 'No major high voltage powerline easement found within 50m.',
      plain_english: 'No major electricity infrastructure easement was identified within or near this lot. Note: this check covers BCC-declared high voltage easements only. Distribution-level easements (underground cables, small substations) are not included. A full title search will confirm all registered easements.',
      cost_time_implication: null,
      easement_count: 0,
      data_source: 'BCC City Plan 2014 — Regional Infrastructure Corridors overlay'
    })

  } catch (err) {
    console.error('[check-easements] Error:', err.message)
    return res.json({
      check: 'easements',
      status: 'ERROR',
      flag: 'AMBER',
      message: 'Easement check unavailable — verify manually.',
      plain_english: 'The powerline easement check could not be completed. Confirm with a cadastral surveyor that no high voltage easement affects this lot before proceeding with subdivision design.',
      cost_time_implication: 'Cadastral surveyor review recommended ($2,000–$4,000).',
      error: err.message,
      data_source: 'BCC City Plan 2014 — Regional Infrastructure Corridors overlay'
    })
  }
}
