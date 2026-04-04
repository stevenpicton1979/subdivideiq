/**
 * load-sw-pipes.js — Load BCC stormwater pipe network into subdivide_sw_pipes
 *
 * Source: BCC Open Data stormwater-pipe-existing
 * https://data.brisbane.qld.gov.au/explore/dataset/stormwater-pipe-existing/
 *
 * Usage:
 *   node scripts/load-sw-pipes.js               # Load all 291k pipes (~20 min)
 *   node scripts/load-sw-pipes.js test          # Load 500 records for testing
 *
 * Geometry: LineString, WGS84 — no transform needed.
 * Diameter field: "825 MM" format — parse to numeric.
 */

require('dotenv').config()
const { Client } = require('pg')

const DATABASE_URL = process.env.DATABASE_URL
const BCC_API = 'https://data.brisbane.qld.gov.au/api/explore/v2.1/catalog/datasets/stormwater-pipe-existing/records'
const PAGE_SIZE = 100

const testMode = process.argv[2] === 'test'

if (!DATABASE_URL) {
  console.error('DATABASE_URL not set in .env')
  process.exit(1)
}

function parseDiameter(diamStr) {
  if (!diamStr) return null
  const match = String(diamStr).match(/(\d+(?:\.\d+)?)/)
  return match ? parseFloat(match[1]) : null
}

async function fetchPipes(offset) {
  const limit = PAGE_SIZE
  // Note: retired field is string "NO"/"YES", not boolean
  let where = `where=retired%3D'NO'%20OR%20retired%20IS%20NULL`
  if (testMode) {
    // In test mode load pipes within 1km of 6 Glenheaton Court Carindale for quick verification
    where = `where=distance(geo_point_2d%2C%20geom'POINT(153.101573%20-27.510775)'%2C%201000m)`
  }
  const url = `${BCC_API}?limit=${limit}&offset=${offset}&${where}`
  const res = await fetch(url)
  if (!res.ok) throw new Error(`BCC API error: ${res.status} — ${await res.text()}`)
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
    if (testMode) console.log('TEST MODE: loading first 500 records only')

    let offset = 0
    let total = null
    let loaded = 0
    let skipped = 0

    while (true) {
      let data
      try {
        data = await fetchPipes(offset)
      } catch (err) {
        console.error(`Fetch error at offset ${offset}:`, err.message)
        break
      }

      if (total === null) {
        total = data.total_count
        console.log(`Total records: ${data.total_count}${testMode ? ' (spatial test area — all records)' : ''}`)
      }

      if (!data.results || data.results.length === 0) break

      const values = []
      for (const r of data.results) {
        const geom = r.geo_shape?.geometry
        if (!geom || geom.type !== 'LineString') { skipped++; continue }

        values.push({
          pipe_id: r.assetid || null,
          material: r.material_abb || null,
          diameter_mm: parseDiameter(r.diameter),
          geom: JSON.stringify(geom)
        })
      }

      if (values.length > 0) {
        const placeholders = values.map((_, i) => {
          const base = i * 4
          return `($${base + 1}, $${base + 2}, $${base + 3}, ST_SetSRID(ST_GeomFromGeoJSON($${base + 4}), 4326))`
        }).join(', ')

        const params = values.flatMap(v => [v.pipe_id, v.material, v.diameter_mm, v.geom])

        try {
          await client.query(
            `INSERT INTO subdivide_sw_pipes (pipe_id, material, diameter_mm, geom)
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
      if (offset % 5000 === 0 || testMode) {
        const pct = Math.round((Math.min(offset, total) / total) * 100)
        process.stdout.write(`\rProgress: ${loaded} loaded, ${skipped} skipped (${pct}%)`)
      }

      if (offset >= total) break
    }

    console.log(`\nDone: ${loaded} loaded, ${skipped} skipped`)

    // Verification: find 825mm pipe near 6 Glenheaton Court Carindale
    console.log('\nVerification — 825mm pipe near 6 Glenheaton Court Carindale:')
    const verify = await client.query(
      `SELECT pipe_id, material, diameter_mm,
              ST_Distance(
                ST_SetSRID(ST_MakePoint(153.101573, -27.510775), 4326)::geography,
                geom::geography
              ) AS dist_m
       FROM subdivide_sw_pipes
       WHERE ST_DWithin(
         ST_SetSRID(ST_MakePoint(153.101573, -27.510775), 4326)::geography,
         geom::geography,
         300
       )
       ORDER BY dist_m ASC
       LIMIT 10`
    )

    if (verify.rows.length > 0) {
      verify.rows.forEach(r => {
        console.log(`  pipe_id=${r.pipe_id} diameter=${r.diameter_mm}mm material=${r.material} dist=${Math.round(r.dist_m)}m`)
      })
      const pipe825 = verify.rows.find(r => parseFloat(r.diameter_mm) === 825)
      if (pipe825) {
        console.log(`  ✅ 825mm pipe found at ${Math.round(pipe825.dist_m)}m distance`)
      } else {
        console.log('  ⚠️  825mm pipe not in top 10 nearest — check after full load')
      }
    } else {
      console.log('  No pipes loaded near Carindale yet — run in test mode to verify')
    }

    console.log('\nload-sw-pipes.js complete ✅')
  } catch (err) {
    console.error('Error:', err.message)
    process.exit(1)
  } finally {
    await client.end()
  }
}

main()
