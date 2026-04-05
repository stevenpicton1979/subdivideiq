/**
 * load-all-suburbs.js — Full Brisbane parcel load via suburb iteration
 *
 * The BCC Opendatasoft API caps at offset+limit <= 10,000 per query, making
 * simple offset pagination impossible for the full 773k parcel dataset.
 *
 * This script:
 *   1. Fetches all distinct suburb names from the BCC parcel facets API
 *   2. Iterates through each suburb, loading all parcels for that suburb
 *   3. All suburbs have < 10,000 lots, so offset pagination works per suburb
 *
 * Usage:
 *   node scripts/load-all-suburbs.js                # Full load all Brisbane suburbs
 *   node scripts/load-all-suburbs.js --resume 150   # Resume from suburb index 150
 *
 * Expected: ~300 suburbs, ~773k records, ~60 min (rate limited to 2 req/s)
 *
 * Progress is logged to load-all-suburbs-progress.json so the run can be resumed.
 */

require('dotenv').config()
const { Client } = require('pg')
const fs = require('fs')
const path = require('path')

const DATABASE_URL = process.env.DATABASE_URL
const BCC_API = 'https://data.brisbane.qld.gov.au/api/explore/v2.1/catalog/datasets/property-boundaries-parcel/records'
const PAGE_SIZE = 100
const PROGRESS_FILE = path.join(__dirname, 'load-all-suburbs-progress.json')

if (!DATABASE_URL) {
  console.error('DATABASE_URL not set in .env')
  process.exit(1)
}

// Parse resume index from args
const resumeArg = process.argv.indexOf('--resume')
const resumeFrom = resumeArg >= 0 ? parseInt(process.argv[resumeArg + 1]) || 0 : 0

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms))
}

async function fetchSuburbs() {
  // Use the /facets endpoint (separate from /records) with limit=500 to get all suburb names
  const url = 'https://data.brisbane.qld.gov.au/api/explore/v2.1/catalog/datasets/property-boundaries-parcel/facets?facet=suburb&limit=500'
  console.log('Fetching suburb list from BCC API...')
  const res = await fetch(url)
  if (!res.ok) throw new Error(`BCC Facets API error: ${res.status}`)
  const data = await res.json()
  const suburbFacet = (data.facets || []).find(f => f.name === 'suburb')
  const suburbs = (suburbFacet?.facets || [])
    .map(f => f.name)
    .filter(Boolean)
    .sort()
  console.log(`Found ${suburbs.length} suburbs`)
  return suburbs
}

async function fetchParcels(offset, suburb) {
  const url = `${BCC_API}?limit=${PAGE_SIZE}&offset=${offset}&where=parcel_typ_desc%3D'LOT'%20AND%20suburb%3D'${encodeURIComponent(suburb)}'`
  const res = await fetch(url)
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`BCC API error: ${res.status} ${body.slice(0, 100)}`)
  }
  return res.json()
}

function toMultiPolygon(geoShape) {
  const geom = geoShape?.geometry
  if (!geom) return null
  if (geom.type === 'MultiPolygon') return geom
  if (geom.type === 'Polygon') return { type: 'MultiPolygon', coordinates: [geom.coordinates] }
  return null
}

function buildAddress(r) {
  const parts = []
  if (r.unit_number) parts.push(`${r.unit_number}/`)
  if (r.house_number) parts.push(r.house_number + (r.house_number_suffix || ''))
  if (r.corridor_name) parts.push(r.corridor_name + (r.corridor_suffix_code ? ` ${r.corridor_suffix_code}` : ''))
  if (r.suburb) parts.push(r.suburb)
  if (r.postcode) parts.push(r.postcode)
  return parts.join(' ')
}

async function loadSuburb(client, suburb) {
  let offset = 0
  let total = null
  let loaded = 0
  let skipped = 0

  while (true) {
    let data
    try {
      data = await fetchParcels(offset, suburb)
    } catch (err) {
      console.error(`  [${suburb}] fetch error at offset ${offset}:`, err.message)
      break
    }

    if (total === null) {
      total = data.total_count
    }

    if (!data.results || data.results.length === 0) break

    const values = []
    for (const r of data.results) {
      const geom = toMultiPolygon(r.geo_shape)
      if (!geom) { skipped++; continue }
      values.push({
        lot: r.lot || null,
        plan: r.plan || null,
        address: buildAddress(r) || null,
        area_m2: r.lot_area || r.shape_area || null,
        geom: JSON.stringify(geom)
      })
    }

    if (values.length > 0) {
      const placeholders = values.map((_, i) => {
        const base = i * 5
        return `($${base+1}, $${base+2}, $${base+3}, $${base+4}, ST_SetSRID(ST_GeomFromGeoJSON($${base+5}), 4326))`
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
        console.error(`  [${suburb}] insert error:`, err.message)
        skipped += values.length
      }
    }

    offset += PAGE_SIZE
    if (!total || offset >= total) break
    await sleep(200) // ~5 req/s per suburb to be polite to BCC API
  }

  return { loaded, skipped, total }
}

async function main() {
  const client = new Client({
    connectionString: DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  })

  try {
    await client.connect()
    console.log('Connected to Supabase fzykfxesznyiigoyeyed')

    // Load progress if resuming
    let progress = {}
    if (fs.existsSync(PROGRESS_FILE)) {
      progress = JSON.parse(fs.readFileSync(PROGRESS_FILE, 'utf8'))
      console.log(`Loaded progress: ${Object.keys(progress).length} suburbs already done`)
    }

    const suburbs = await fetchSuburbs()

    let totalLoaded = 0
    let totalSkipped = 0

    for (let i = resumeFrom; i < suburbs.length; i++) {
      const suburb = suburbs[i]

      if (progress[suburb]) {
        process.stdout.write(`[${i+1}/${suburbs.length}] ${suburb.padEnd(25)} (already done — ${progress[suburb].loaded} records)\n`)
        totalLoaded += progress[suburb].loaded
        continue
      }

      process.stdout.write(`[${i+1}/${suburbs.length}] ${suburb.padEnd(25)} `)
      const result = await loadSuburb(client, suburb)
      process.stdout.write(`${result.loaded} loaded, ${result.skipped} skipped\n`)

      totalLoaded  += result.loaded
      totalSkipped += result.skipped

      // Save progress
      progress[suburb] = result
      fs.writeFileSync(PROGRESS_FILE, JSON.stringify(progress, null, 2))

      // Rate limit: 0.5s between suburbs
      await sleep(500)
    }

    // Final count
    const r = await client.query('SELECT COUNT(*) FROM subdivide_parcels')
    console.log(`\nTotal loaded this run: ${totalLoaded} | Total in table: ${r.rows[0].count}`)
    console.log('load-all-suburbs.js complete ✅')

  } catch (err) {
    console.error('Fatal error:', err.message)
    process.exit(1)
  } finally {
    await client.end()
  }
}

main()
