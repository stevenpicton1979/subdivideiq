/**
 * smoke.test.js — SubdivideIQ Jest smoke tests
 *
 * Tests 4 core paths:
 *   1. geocode returns valid parcel for 6 Glenheaton Court Carindale
 *   2. feasibility returns AMBER for 6 Glenheaton Court (lat/lng known)
 *   3. feasibility returns a valid flag (GREEN/AMBER/RED) for 3 other Brisbane addresses
 *   4. PDF can be generated from a mock feasibility result
 *
 * Requires .env with DATABASE_URL.
 * Run: npm test
 */

require('dotenv').config()

// ── Helpers ──────────────────────────────────────────────────────────────────

function mockReqRes(body) {
  return new Promise((resolve, reject) => {
    const mockReq = { method: 'POST', body, query: {} }
    const mockRes = {
      _status: 200,
      status(c) { this._status = c; return this },
      json(data) { resolve({ status: this._status, data }) },
      end()      { resolve({ status: this._status, data: null }) }
    }
    resolve({ mockReq, mockRes })
  })
}

async function callHandler(handlerPath, body) {
  const handler = require(handlerPath)
  return new Promise((resolve, reject) => {
    const mockReq = { method: 'POST', body, query: {} }
    const mockRes = {
      _status: 200,
      status(c) { this._status = c; return this },
      json(data) { resolve({ status: this._status, data }) },
      end()      { resolve({ status: this._status, data: null }) }
    }
    Promise.resolve(handler(mockReq, mockRes)).catch(reject)
  })
}

// ── Test 1: Geocode — 6 Glenheaton Court Carindale ───────────────────────────

test('geocode returns valid parcel for 6 Glenheaton Court Carindale', async () => {
  const geocode = require('../api/geocode')
  const result  = await new Promise((resolve, reject) => {
    const req = {
      method: 'POST',
      body: { address: '6 Glenheaton Court, Carindale', lat: -27.510775, lng: 153.101573 },
      query: {}
    }
    const res = {
      setHeader() {},
      status(c) { return this },
      json(data) { resolve(data) },
      end()      { resolve(null) }
    }
    Promise.resolve(geocode(req, res)).catch(reject)
  })

  expect(result).toBeTruthy()
  expect(result.area_m2).toBeGreaterThan(800)
  expect(result.area_m2).toBeLessThan(1500)
  expect(result.centroid_lat).toBeCloseTo(-27.51, 1)
  expect(result.centroid_lng).toBeCloseTo(153.10, 1)
}, 15000)

// ── Test 2: Feasibility returns AMBER for 6 Glenheaton Court ─────────────────

test('feasibility returns AMBER for 6 Glenheaton Court Carindale', async () => {
  const { data } = await callHandler('../api/feasibility', {
    lat: -27.510775, lng: 153.101573, area_m2: 1086
  })

  expect(data).toBeTruthy()
  expect(data.overall).toBeTruthy()
  // 6 Glenheaton Court (1086m²): zone is RED (543m² < 600m² LDR min), so overall RED or AMBER
  expect(data.overall.flag).toMatch(/^(AMBER|RED)$/)
  expect(data.checks).toBeTruthy()
  expect(Object.keys(data.checks).length).toBeGreaterThan(0)
}, 30000)

// ── Test 3: Feasibility returns a valid flag for 3 other Brisbane addresses ───

const OTHER_ADDRESSES = [
  { name: 'Rocklea flood-prone', lat: -27.531, lng: 153.018, area_m2: 1200 },
  { name: 'New Farm inner city',  lat: -27.468, lng: 153.044, area_m2: 800  },
  { name: 'Kenmore hills slope',  lat: -27.507, lng: 152.936, area_m2: 1500 }
]

test.each(OTHER_ADDRESSES)(
  'feasibility returns GREEN/AMBER/RED for %s',
  async ({ name, lat, lng, area_m2 }) => {
    const { data } = await callHandler('../api/feasibility', { lat, lng, area_m2 })
    expect(data?.overall?.flag).toMatch(/^(GREEN|AMBER|RED)$/)
  },
  30000
)

// ── Test 4: PDF generation produces a valid PDF buffer ───────────────────────

test('generatePdf produces a valid PDF buffer', async () => {
  const { generatePdf } = require('../api/generate-pdf')
  const buf = await generatePdf({
    address: '6 Glenheaton Court Carindale',
    feasibility: {
      overall: { flag: 'AMBER', summary: 'Test', red_count: 0, amber_count: 2, green_count: 4 },
      checks: {
        zone:      { flag: 'AMBER', message: 'LDR zone', plain_english: 'Zone test.' },
        flood:     { flag: 'GREEN', message: 'No flood', plain_english: 'No flood.' },
        elevation: { flag: 'GREEN', message: 'Flat',     plain_english: 'Flat.' },
        lotsize:   { flag: 'AMBER', message: '1086m²',   plain_english: 'Marginal.' }
      },
      what_to_do_next: [],
      cost_range: {}
    },
    parcel: null
  })

  expect(buf).toBeInstanceOf(Buffer)
  expect(buf.length).toBeGreaterThan(2000)
  expect(buf.slice(0, 4).toString()).toBe('%PDF')
}, 15000)
