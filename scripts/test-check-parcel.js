/**
 * test-check-parcel.js — ARCH-1 verification
 * Tests check-parcel.js against 3 SEQ coordinates to confirm BCC+DCDB dual-source works.
 * Run: node scripts/test-check-parcel.js
 */

require('dotenv').config()

const handler = require('../api/check-parcel')

const TEST_CASES = [
  {
    name: 'BCC — 6 Glenheaton Court Carindale',
    lat: -27.5107,
    lng: 153.1015,
    expectSource: 'supabase_bcc',
    expectLot: '15',
    expectPlan: 'RP182797'
  },
  {
    name: 'Gold Coast — Surfers Paradise area',
    lat: -27.9826,
    lng: 153.4082,
    expectSource: 'dcdb',
    expectLot: null
  },
  {
    name: 'Moreton Bay — Narangba area',
    lat: -27.0397,
    lng: 152.9625,
    expectSource: 'dcdb',
    expectLot: null
  }
]

async function runTest({ name, lat, lng, expectSource, expectLot, expectPlan }) {
  return new Promise((resolve) => {
    const req = {
      method: 'GET',
      query: { lat: String(lat), lng: String(lng) }
    }
    const res = {
      _status: 200,
      status(c) { this._status = c; return this },
      json(data) {
        const ok = (
          data &&
          typeof data.lot !== 'undefined' &&
          (expectLot === null || data.lot === expectLot) &&
          (expectPlan === undefined || data.plan === expectPlan) &&
          (data.source === expectSource || data.source?.startsWith(expectSource))
        )
        resolve({
          name,
          pass: ok,
          status: this._status,
          data
        })
      },
      end() { resolve({ name, pass: false, status: this._status, data: null }) }
    }
    Promise.resolve(handler(req, res)).catch(err => {
      resolve({ name, pass: false, error: err.message })
    })
  })
}

async function main() {
  console.log('=== check-parcel.js ARCH-1 verification ===\n')
  const results = []

  for (const tc of TEST_CASES) {
    const r = await runTest(tc)
    results.push(r)

    const status = r.pass ? 'PASS ✅' : 'FAIL ❌'
    console.log(`${status} ${r.name}`)
    if (r.data) {
      console.log(`       lot=${r.data.lot} plan=${r.data.plan} area=${r.data.area_m2}m² source=${r.data.source}`)
    }
    if (r.error) console.log(`       ERROR: ${r.error}`)
    console.log()
  }

  const passed = results.filter(r => r.pass).length
  console.log(`Results: ${passed}/${results.length} PASS`)
  process.exit(passed === results.length ? 0 : 1)
}

main()
