/**
 * load-parcels.js — Load BCC parcel data into subdivide_parcels
 *
 * Source: BCC Open Data property-boundaries-parcel (DCDB)
 * https://data.brisbane.qld.gov.au/explore/dataset/property-boundaries-parcel/
 *
 * Usage:
 *   node scripts/load-parcels.js                   # Load all Brisbane parcels (full run ~897k, takes ~30 min)
 *   node scripts/load-parcels.js CARINDALE         # Load single suburb (fast, for testing)
 *   node scripts/load-parcels.js CARINDALE CARINA  # Load multiple suburbs
 *
 * Note: BCC parcel data is already WGS84 — no transform needed.
 * Lots are stored as MultiPolygon in Supabase; Polygon geometries are wrapped.
 */

require('dotenv').config()
const { Client } = require('pg')

const DATABASE_URL = process.env.DATABASE_URL
const BCC_API = 'https://data.brisbane.qld.gov.au/api/explore/v2.1/catalog/datasets/property-boundaries-parcel/records'
const PAGE_SIZE = 100

const suburbFilter = process.argv.slice(2)

if (!DATABASE_URL) {
  console.error('DATABASE_URL not set in .env')
  process.exit(1)
}

async function fetchParcels(offset, suburb) {
  let url = `${BCC_API}?limit=${PAGE_SIZE}&offset=${offset}&where=parcel_typ_desc%3D'LOT'`
  if (suburb) {
    url += `%20AND%20suburb%3D'${encodeURIComponent(suburb.toUpperCase())}'`
  }

  const res = await fetch(url)
  if (!res.ok) throw new Error(`BCC API error: ${res.status}`)
  return res.json()
}

function toMultiPolygon(geoShape) {
  const geom = geoShape?.geometry
  if (!geom) return null

  if (geom.type === 'MultiPolygon') {
    return geom
  } else if (geom.type === 'Polygon') {
    // Wrap Polygon in MultiPolygon
    return {
      type: 'MultiPolygon',
      coordinates: [geom.coordinates]
    }
  }
  return null
}

function buildAddress(r) {
  const parts = []
  if (r.unit_number) parts.push(`${r.unit_number}/`)
  if (r.house_number) {
    parts.push(r.house_number + (r.house_number_suffix || ''))
  }
  if (r.corridor_name) {
    parts.push(r.corridor_name + (r.corridor_suffix_code ? ` ${r.corridor_suffix_code}` : ''))
  }
  if (r.suburb) parts.push(r.suburb)
  if (r.postcode) parts.push(r.postcode)
  return parts.join(' ')
}

async function loadSuburb(client, suburb) {
  let offset = 0
  let total = null
  let loaded = 0
  let skipped = 0

  console.log(`\nLoading${suburb ? ` ${suburb}` : ' all Brisbane'}...`)

  while (true) {
    let data
    try {
      data = await fetchParcels(offset, suburb)
    } catch (err) {
      console.error(`  Fetch error at offset ${offset}:`, err.message)
      break
    }

    if (total === null) {
      total = data.total_count
      console.log(`  Total records: ${total}`)
    }

    if (!data.results || data.results.length === 0) break

    const values = []
    for (const r of data.results) {
      const geom = toMultiPolygon(r.geo_shape)
      if (!geom) { skipped++; continue }

      const address = buildAddress(r)
      values.push({
        lot: r.lot || null,
        plan: r.plan || null,
        address: address || null,
        area_m2: r.lot_area || r.shape_area || null,
        geom: JSON.stringify(geom)
      })
    }

    if (values.length > 0) {
      // Build parameterised INSERT
      const placeholders = values.map((_, i) => {
        const base = i * 5
        return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, ST_SetSRID(ST_GeomFromGeoJSON($${base + 5}), 4326))`
      }).join(', ')

      const params = values.flatMap(v => [v.lot, v.plan, v.address, v.area_m2, v.geom])

      try {
        await client.query(
          `INSERT INTO subdivide_parcels (lot, plan, address, area_m2, geom)
           VALUES ${placeholders}
           ON CONFLICT DO NOTHING`,
          params
        )
        loaded += values.length
      } catch (err) {
        console.error(`  Insert error at offset ${offset}:`, err.message)
        skipped += values.length
      }
    }

    offset += PAGE_SIZE
    if (offset % 1000 === 0) {
      const pct = Math.round((offset / total) * 100)
      process.stdout.write(`\r  Progress: ${loaded} loaded, ${skipped} skipped (${pct}%)`)
    }

    if (offset >= total) break
  }

  console.log(`\n  Done: ${loaded} loaded, ${skipped} skipped`)
  return loaded
}

async function main() {
  const client = new Client({
    connectionString: DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  })

  try {
    await client.connect()
    console.log('Connected to Supabase fzykfxesznyiigoyeyed')

    const suburbs = suburbFilter.length > 0 ? suburbFilter : [null] // null = all

    for (const suburb of suburbs) {
      await loadSuburb(client, suburb)
    }

    // Verification query
    console.log('\nVerification — querying 6 Glenheaton Court Carindale:')
    const verify = await client.query(
      `SELECT lot, plan, address, area_m2,
              ST_AsText(geom) as geom_preview,
              ST_AsGeoJSON(ST_Centroid(geom::geometry))::json as centroid
       FROM subdivide_parcels
       WHERE address ILIKE '%6%GLENHEATON%CARINDALE%'
          OR (lot = '15' AND plan = 'RP182797')
       LIMIT 3`
    )

    if (verify.rows.length > 0) {
      verify.rows.forEach(r => {
        console.log(`  lot=${r.lot} plan=${r.plan} address="${r.address}" area_m2=${r.area_m2}`)
        if (r.centroid) {
          const c = r.centroid
          console.log(`  centroid: ${c.coordinates[1].toFixed(6)}, ${c.coordinates[0].toFixed(6)}`)
        }
      })
      const row = verify.rows[0]
      const expected = 1086
      const diff = Math.abs(parseFloat(row.area_m2) - expected)
      if (diff < 20) {
        console.log(`  ✅ Area check: ${row.area_m2}m² (expected ~${expected}m²)`)
      } else {
        console.log(`  ⚠️  Area check: ${row.area_m2}m² (expected ~${expected}m²)`)
      }
    } else {
      console.log('  ⚠️  Parcel not found — run with CARINDALE argument to load suburb data')
    }

    console.log('\nload-parcels.js complete ✅')
  } catch (err) {
    console.error('Error:', err.message)
    process.exit(1)
  } finally {
    await client.end()
  }
}

main()
