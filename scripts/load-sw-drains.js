/**
 * load-sw-drains.js — Load BCC surface drain network into subdivide_sw_drains
 *
 * Source: BCC Open Data stormwater-surface-drain-existing
 * https://data.brisbane.qld.gov.au/explore/dataset/stormwater-surface-drain-existing/
 *
 * Usage:
 *   node scripts/load-sw-drains.js    # Load all 2343 drain records
 *
 * Geometry: LineString, WGS84 — no transform needed.
 *
 * Drain types of note for SubdivideIQ feasibility checks:
 *   FLOODWAY — equivalent to mapped overland flow path
 *   SWALE — shallow grass-lined channel, overland flow indicator
 *   EARTH DRAIN — unlined channel, flow path indicator
 *   GRASS LINED, CONCRETE LINED, STONE PITCHED — engineered drains
 *   UNKNOWN — unmapped / unclassified
 *
 * Note: BCC Open Data does not have a dedicated "Overland Flowpath" type in this
 * dataset (as of April 2026). Use FLOODWAY and SWALE as overland flow proxies.
 * The flood_overlays table in ZoneIQ has the formal overland flow planning overlay.
 */

require('dotenv').config()
const { Client } = require('pg')

const DATABASE_URL = process.env.DATABASE_URL
const BCC_API = 'https://data.brisbane.qld.gov.au/api/explore/v2.1/catalog/datasets/stormwater-surface-drain-existing/records'
const PAGE_SIZE = 100

if (!DATABASE_URL) {
  console.error('DATABASE_URL not set in .env')
  process.exit(1)
}

async function fetchDrains(offset) {
  const url = `${BCC_API}?limit=${PAGE_SIZE}&offset=${offset}`
  const res = await fetch(url)
  if (!res.ok) throw new Error(`BCC API error: ${res.status}`)
  return res.json()
}

async function main() {
  const client = new Client({
    connectionString: DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  })

  try {
    await client.connect()
    console.log('Connected to Supabase fzykfxesznyiigoyeyed')

    let offset = 0
    let total = null
    let loaded = 0
    let skipped = 0

    while (true) {
      let data
      try {
        data = await fetchDrains(offset)
      } catch (err) {
        console.error(`Fetch error at offset ${offset}:`, err.message)
        break
      }

      if (total === null) {
        total = data.total_count
        console.log(`Total surface drain records: ${total}`)
      }

      if (!data.results || data.results.length === 0) break

      const values = []
      for (const r of data.results) {
        const geom = r.geo_shape?.geometry
        if (!geom || geom.type !== 'LineString') { skipped++; continue }

        values.push({
          drain_id: r.assetid || null,
          drain_type: r.surfacedraintype || null,
          geom: JSON.stringify(geom)
        })
      }

      if (values.length > 0) {
        const placeholders = values.map((_, i) => {
          const base = i * 3
          return `($${base + 1}, $${base + 2}, ST_SetSRID(ST_GeomFromGeoJSON($${base + 3}), 4326))`
        }).join(', ')

        const params = values.flatMap(v => [v.drain_id, v.drain_type, v.geom])

        try {
          await client.query(
            `INSERT INTO subdivide_sw_drains (drain_id, drain_type, geom)
             VALUES ${placeholders}
             ON CONFLICT DO NOTHING`,
            params
          )
          loaded += values.length
        } catch (err) {
          console.error(`Insert error at offset ${offset}:`, err.message)
          skipped += values.length
        }
      }

      offset += PAGE_SIZE
      if (offset >= total) break
    }

    console.log(`Done: ${loaded} loaded, ${skipped} skipped`)

    // Summary by drain type
    const summary = await client.query(
      `SELECT drain_type, COUNT(*) as count
       FROM subdivide_sw_drains
       GROUP BY drain_type
       ORDER BY count DESC`
    )
    console.log('\nDrain types loaded:')
    summary.rows.forEach(r => console.log(`  ${r.drain_type || 'null'}: ${r.count}`))

    // Flag floodway/swale count (key for feasibility checks)
    const flowPaths = summary.rows.filter(r =>
      ['FLOODWAY', 'SWALE', 'EARTH DRAIN'].includes(r.drain_type)
    )
    if (flowPaths.length > 0) {
      const total_flow = flowPaths.reduce((s, r) => s + parseInt(r.count), 0)
      console.log(`\n  ✅ Overland flow proxy drains (FLOODWAY + SWALE + EARTH DRAIN): ${total_flow}`)
    }

    // Verification: find drains near 6 Glenheaton Court Carindale
    console.log('\nVerification — drains within 200m of 6 Glenheaton Court Carindale:')
    const verify = await client.query(
      `SELECT drain_id, drain_type,
              ST_Distance(
                ST_SetSRID(ST_MakePoint(153.101573, -27.510775), 4326)::geography,
                geom::geography
              ) AS dist_m
       FROM subdivide_sw_drains
       WHERE ST_DWithin(
         ST_SetSRID(ST_MakePoint(153.101573, -27.510775), 4326)::geography,
         geom::geography,
         200
       )
       ORDER BY dist_m ASC
       LIMIT 5`
    )

    if (verify.rows.length > 0) {
      verify.rows.forEach(r => {
        console.log(`  drain_id=${r.drain_id} type=${r.drain_type} dist=${Math.round(r.dist_m)}m`)
      })
      console.log('  ✅ Surface drains verified near test address')
    } else {
      console.log('  No drains found within 200m — may be sparse in this area (normal)')
    }

    console.log('\nload-sw-drains.js complete ✅')
  } catch (err) {
    console.error('Error:', err.message)
    process.exit(1)
  } finally {
    await client.end()
  }
}

main()
