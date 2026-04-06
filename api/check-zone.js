/**
 * check-zone.js — Zone and minimum lot size check
 *
 * POST /api/check-zone
 * Body: { lat, lng }
 *
 * Queries zone_geometries + zone_rules in Supabase.
 * Logic: 1086m² lot ÷ 2 = 543m² each side — must both meet subdivision_min_lot_size_m2
 * Returns: { status, zone_code, zone_name, min_lot_size_m2, council, ... }
 *
 * Status logic (applied in S2-7 aggregator, but preview returned here):
 *   PASS    — both new lots exceed minimum
 *   MARGINAL — one or both lots barely meet minimum (within 20%)
 *   FAIL    — lot too small to produce two compliant lots
 */

const { getClient } = require('./lib/db')

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).end()

  const { lat, lng, area_m2 } = req.body || {}
  if (!lat || !lng) return res.status(400).json({ error: 'lat and lng required' })

  const client = getClient()
  try {
    await client.connect()

    const result = await client.query(
      `SELECT
         zg.zone_code,
         zg.council,
         zr.zone_name,
         zr.zone_category,
         zr.subdivision_min_lot_size_m2,
         zr.max_height_m,
         zr.max_storeys,
         zr.max_site_coverage_pct,
         zr.front_setback_m,
         zr.side_setback_m,
         zr.rear_setback_m,
         zr.secondary_dwelling_permitted,
         zr.key_rules,
         zr.notes
       FROM zone_geometries zg
       JOIN zone_rules zr ON zg.zone_code = zr.zone_code AND zg.council = zr.council
       WHERE ST_Contains(
         zg.geometry,
         ST_SetSRID(ST_MakePoint($1, $2), 4326)
       )
       LIMIT 1`,
      [lng, lat]
    )

    if (result.rows.length === 0) {
      return res.json({
        check: 'zone',
        status: 'UNKNOWN',
        flag: 'AMBER',
        message: 'Zone not found — address may be outside covered area',
        zone_code: null,
        zone_name: null,
        min_lot_size_m2: null,
        council: null
      })
    }

    const row = result.rows[0]
    const minLot = row.subdivision_min_lot_size_m2
    const lotArea = area_m2 || null

    let splitViable = null
    let status = 'UNKNOWN'
    let flag = 'AMBER'
    let message = ''

    // Special case: Innovation zone (Gold Coast) — residential subdivision not primary use
    if (row.zone_code === 'Innovation' && row.council === 'goldcoast') {
      status = 'RESTRICTED'
      flag = 'AMBER'
      splitViable = false
      message = 'This lot is zoned Innovation — intended for knowledge industries, research and technology uses. Residential subdivision is not a primary use and would require a permit. Speak to a Gold Coast town planner before proceeding.'
    } else if (minLot && lotArea) {
      // Thresholds based on total lot area vs minimum lot size:
      //   GREEN  — lotArea > minLot * 2.1  (both halves clearly above minimum)
      //   AMBER  — lotArea >= minLot * 1.5 (marginal — town planner can often find a path)
      //   RED    — lotArea < minLot * 1.5  (hard blocker — no realistic split configuration works)
      if (lotArea > minLot * 2.1) {
        status = 'PASS'
        flag = 'GREEN'
        message = `Lot area (${Math.round(lotArea)}m²) comfortably supports two lots above the ${minLot}m² minimum for ${row.zone_name}`
      } else if (lotArea >= minLot * 1.5) {
        status = 'MARGINAL'
        flag = 'AMBER'
        message = `Marginal lot size — subdivision may be viable with a creative split or reconfiguration. Town planner consultation strongly recommended.`
      } else {
        status = 'FAIL'
        flag = 'RED'
        message = `Lot area (${Math.round(lotArea)}m²) is too small to reliably produce two lots meeting the ${minLot}m² minimum for ${row.zone_name}. Subdivision is unlikely to be viable.`
      }
      splitViable = lotArea >= minLot * 1.5
    } else if (minLot) {
      message = `Minimum lot size for ${row.zone_name} is ${minLot}m²`
    }

    // Ensure plain_english is never empty
    const plainEnglish = message ||
      'Zone rules exist for this lot but subdivision viability could not be automatically determined. A town planner can confirm whether a split is permitted under the current planning scheme.'

    return res.json({
      check: 'zone',
      status,
      flag,
      message: plainEnglish,
      zone_code: row.zone_code,
      zone_name: row.zone_name,
      zone_category: row.zone_category,
      council: row.council,
      min_lot_size_m2: minLot,
      max_height_m: row.max_height_m,
      max_storeys: row.max_storeys,
      max_site_coverage_pct: row.max_site_coverage_pct,
      front_setback_m: row.front_setback_m,
      side_setback_m: row.side_setback_m,
      rear_setback_m: row.rear_setback_m,
      secondary_dwelling_permitted: row.secondary_dwelling_permitted,
      key_rules: row.key_rules,
      notes: row.notes,
      split_viable: splitViable,
      plain_english: plainEnglish,
      cost_time_implication: null
    })
  } catch (err) {
    console.error('check-zone error:', err.message)
    return res.status(500).json({ error: 'Zone check failed', check: 'zone', flag: 'AMBER' })
  } finally {
    await client.end()
  }
}
