/**
 * webhook.js — Stripe webhook handler for SubdivideIQ
 *
 * POST /api/webhook
 * Handles checkout.session.completed:
 *   1. Verify Stripe signature against raw body
 *   2. Extract address + email from session metadata
 *   3. Geocode address → parcel data
 *   4. Run feasibility engine
 *   5. Generate PDF via generate-pdf.js
 *   6. Send PDF attachment via Resend
 *   7. Log to subdivide_reports (Supabase)
 *
 * IMPORTANT: Raw body must be read before any JSON parsing for Stripe sig verification.
 * Vercel Node.js serverless functions do not pre-parse the body — read raw from req stream.
 *
 * Vercel config: must set bodyParser: false for this route (see vercel.json note below).
 * Add to vercel.json:
 *   "routes": [{ "src": "/api/webhook", "dest": "/api/webhook" }]
 * And Vercel will auto-detect the module.exports with no bodyParser needed.
 */

const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY)
const { createClient } = require('@supabase/supabase-js')
const { Resend } = require('resend')
const { generatePdf } = require('./generate-pdf')

function getSupabase() {
  return createClient(
    process.env.SUPABASE_URL || 'https://fzykfxesznyiigoyeyed.supabase.co',
    process.env.SUPABASE_SERVICE_KEY
  )
}

async function readRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    req.on('data', chunk => chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk))
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', reject)
  })
}

// Vercel: disable body parser so we can read raw stream for Stripe signature verification
module.exports.config = { api: { bodyParser: false } }

module.exports = async (req, res) => {
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST')   return res.status(405).json({ error: 'Method not allowed' })

  const sig = req.headers['stripe-signature']
  if (!sig) return res.status(400).json({ error: 'Missing stripe-signature header' })

  // Read raw body for signature verification
  let rawBody
  try {
    rawBody = await readRawBody(req)
  } catch (err) {
    console.error('[webhook] Failed to read body:', err.message)
    return res.status(400).json({ error: 'Failed to read request body' })
  }

  // Verify Stripe signature
  let event
  try {
    event = stripe.webhooks.constructEvent(rawBody, sig, process.env.STRIPE_WEBHOOK_SECRET)
  } catch (err) {
    console.error('[webhook] Signature verification failed:', err.message)
    return res.status(400).send('Webhook Error: ' + err.message)
  }

  // Only handle completed checkouts
  if (event.type !== 'checkout.session.completed') {
    return res.json({ received: true, ignored: true })
  }

  const session       = event.data.object
  const sessionId     = session.id
  const customerEmail = session.customer_details?.email || session.metadata?.email
  const meta          = session.metadata || {}
  const { address, lat, lng } = meta

  console.log('[webhook] Processing:', sessionId, 'address:', address)

  // Respond to Stripe immediately (must within 30s) — process async
  res.json({ received: true })

  // Process report generation async (non-blocking to Stripe)
  processReport({ sessionId, customerEmail, address, lat, lng }).catch(err => {
    console.error('[webhook] processReport failed:', err.message)
  })
}

async function processReport({ sessionId, customerEmail, address, lat, lng }) {
  const db = getSupabase()

  // Log pending report to Supabase immediately
  try {
    await db.from('subdivide_reports').insert({
      address,
      stripe_session_id: sessionId,
      email: customerEmail || null,
      result: 'PENDING',
      flags: {},
      created_at: new Date().toISOString()
    })
  } catch (err) {
    console.error('[webhook] Initial Supabase insert failed:', err.message)
    // Non-fatal — continue
  }

  // 1. Geocode address → parcel data
  let parcel = null
  try {
    parcel = await geocodeForWebhook(address, lat, lng)
  } catch (err) {
    console.error('[webhook] Geocode failed:', err.message)
    // Continue without parcel — feasibility uses lat/lng fallback
  }

  const feasLat = parcel?.centroid_lat || (lat ? parseFloat(lat) : null)
  const feasLng = parcel?.centroid_lng || (lng ? parseFloat(lng) : null)

  if (!feasLat || !feasLng) {
    console.error('[webhook] No coordinates available for feasibility check')
    await updateReport(db, sessionId, { result: 'ERROR', flags: { error: 'Could not geocode address' } })
    return
  }

  // 2. Run feasibility engine
  let feasibility = null
  try {
    feasibility = await runFeasibility({
      lat: feasLat,
      lng: feasLng,
      geom_geojson: parcel?.geom_geojson || null,
      area_m2: parcel?.area_m2 || null
    })
  } catch (err) {
    console.error('[webhook] Feasibility failed:', err.message)
    await updateReport(db, sessionId, { result: 'ERROR', flags: { error: err.message } })
    return
  }

  const overallFlag = feasibility?.overall?.flag || 'AMBER'

  // 3. Generate PDF
  let pdfBuffer = null
  try {
    pdfBuffer = await generatePdf({ address, feasibility, parcel })
    console.log('[webhook] PDF generated, size:', pdfBuffer?.length, 'bytes')
  } catch (err) {
    console.error('[webhook] PDF generation failed:', err.message)
    // Continue — still send email with text fallback
  }

  // 4. Send email via Resend
  if (customerEmail && process.env.RESEND_API_KEY) {
    try {
      const resend = new Resend(process.env.RESEND_API_KEY)
      const emailPayload = {
        from: 'SubdivideIQ <hello@clearoffer.com.au>',
        to: customerEmail,
        subject: `Your SubdivideIQ Report — ${address}`,
        html: buildEmailHtml(address, feasibility),
        attachments: pdfBuffer ? [{
          filename: `SubdivideIQ-Report-${slugify(address)}.pdf`,
          content: pdfBuffer
        }] : []
      }
      await resend.emails.send(emailPayload)
      console.log('[webhook] Email sent to:', customerEmail)
    } catch (err) {
      console.error('[webhook] Email failed:', err.message)
      // Non-fatal
    }
  }

  // 5. Update Supabase record with result
  try {
    await updateReport(db, sessionId, {
      result: overallFlag,
      flags: {
        overall: feasibility?.overall || null,
        checks:  Object.fromEntries(
          Object.entries(feasibility?.checks || {}).map(([k, v]) => [k, {
            flag: v?.flag,
            status: v?.status,
            message: v?.message
          }])
        ),
        lot: parcel ? {
          lot:     parcel.lot,
          plan:    parcel.plan,
          area_m2: parcel.area_m2
        } : null
      }
    })
    console.log('[webhook] Supabase updated:', sessionId, overallFlag)
  } catch (err) {
    console.error('[webhook] Supabase update failed:', err.message)
  }
}

async function updateReport(db, sessionId, fields) {
  const { error } = await db
    .from('subdivide_reports')
    .update(fields)
    .eq('stripe_session_id', sessionId)
  if (error) throw new Error('Supabase update: ' + error.message)
}

async function geocodeForWebhook(address, lat, lng) {
  // If lat/lng supplied from session metadata, look up parcel directly
  if (lat && lng) {
    const { getClient } = require('./lib/db')
    const client = getClient()
    try {
      await client.connect()
      const pLng = parseFloat(lng)
      const pLat = parseFloat(lat)
      const result = await client.query(
        `SELECT lot, plan, address, area_m2,
           ST_AsGeoJSON(geom)::json AS geom_geojson,
           ST_Y(ST_Centroid(geom::geometry)) AS centroid_lat,
           ST_X(ST_Centroid(geom::geometry)) AS centroid_lng
         FROM subdivide_parcels
         WHERE ST_Contains(geom::geometry, ST_SetSRID(ST_MakePoint($1, $2), 4326)::geometry)
           AND area_m2 > 100
         LIMIT 1`,
        [pLng, pLat]
      )
      if (result.rows.length > 0) {
        const r = result.rows[0]
        return {
          lot: r.lot, plan: r.plan, address: r.address,
          area_m2: parseFloat(r.area_m2),
          geom_geojson: r.geom_geojson,
          centroid_lat: parseFloat(r.centroid_lat),
          centroid_lng: parseFloat(r.centroid_lng)
        }
      }
    } finally {
      await client.end()
    }
    // Return centroid with no parcel polygon
    return { centroid_lat: parseFloat(lat), centroid_lng: parseFloat(lng), area_m2: null }
  }

  // No coords — would need Mapbox geocoding but no token in server context for webhook
  // Return null and let caller handle
  return null
}

async function runFeasibility({ lat, lng, geom_geojson, area_m2 }) {
  const handler = require('./feasibility')
  return new Promise((resolve, reject) => {
    const mockReq = { method: 'POST', body: { lat, lng, geom_geojson, area_m2 }, query: {} }
    const mockRes = {
      status(c) { return this },
      json(data) { resolve(data) },
      end()      { resolve(null) }
    }
    Promise.resolve(handler(mockReq, mockRes)).catch(reject)
  })
}

function buildEmailHtml(address, feasibility) {
  const flag    = feasibility?.overall?.flag || 'AMBER'
  const summary = feasibility?.overall?.summary || ''
  const colours = { GREEN: '#16a34a', AMBER: '#d97706', RED: '#dc2626' }
  const colour  = colours[flag] || colours.AMBER

  const checks = feasibility?.checks || {}
  const checkRows = Object.entries(checks).map(([key, c]) => {
    if (!c) return ''
    const label = {
      zone: 'Zone', flood: 'Flood', elevation: 'Slope', stormwater: 'Stormwater',
      character: 'Character', lotsize: 'Lot Size', contaminated: 'Contaminated Land',
      infrastructure: 'Infrastructure Charges', easements: 'Powerline Easements',
      acidsulfate: 'Acid Sulfate Soils'
    }[key] || key
    const fColour = colours[c.flag] || colours.AMBER
    return `<tr>
      <td style="padding:8px 12px;border-bottom:1px solid #f1f5f9;font-size:13px;color:#1e293b;">
        <span style="background:${fColour};color:#fff;font-size:10px;font-weight:700;padding:2px 8px;border-radius:3px;margin-right:8px;">${c.flag}</span>
        <strong>${label}</strong><br>
        <span style="color:#64748b;font-size:12px;">${escHtml(c.message || '')}</span>
      </td>
    </tr>`
  }).join('')

  return `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f8fafc;margin:0;padding:0;">
  <div style="max-width:560px;margin:0 auto;padding:40px 20px;">
    <h2 style="color:#1e293b;margin:0 0 4px;font-size:20px;font-weight:800;">SubdivideIQ</h2>
    <p style="color:#64748b;font-size:13px;margin:0 0 28px;">Subdivision Feasibility Report</p>

    <h1 style="font-size:20px;font-weight:800;color:#0f172a;margin:0 0 6px;">Your report is attached</h1>
    <p style="color:#64748b;font-size:14px;margin:0 0 24px;">${escHtml(address)}</p>

    <div style="background:${colour};border-radius:10px;padding:20px;margin-bottom:24px;text-align:center;">
      <p style="color:#fff;font-size:22px;font-weight:800;margin:0 0 6px;">
        ${flag === 'GREEN' ? 'GREEN — LIKELY VIABLE' : flag === 'AMBER' ? 'AMBER — PROCEED WITH CAUTION' : 'RED — SIGNIFICANT CONSTRAINT'}
      </p>
      <p style="color:rgba(255,255,255,0.9);font-size:13px;margin:0;">${escHtml(summary)}</p>
    </div>

    <div style="background:#fff;border:1px solid #e2e8f0;border-radius:10px;overflow:hidden;margin-bottom:24px;">
      <p style="font-size:11px;font-weight:700;color:#94a3b8;text-transform:uppercase;letter-spacing:.06em;padding:12px 12px 0;">Check Results</p>
      <table style="width:100%;border-collapse:collapse;">${checkRows}</table>
    </div>

    <p style="color:#94a3b8;font-size:12px;line-height:1.6;">Your full PDF report is attached to this email.</p>
    <p style="color:#94a3b8;font-size:11px;line-height:1.6;margin-top:24px;padding-top:16px;border-top:1px solid #e2e8f0;">
      DISCLAIMER: This report is a pre-screen tool only — not engineering or legal advice. Always engage qualified professionals before making development or financial decisions.
    </p>
  </div>
</body>
</html>`
}

function escHtml(str) {
  if (!str) return ''
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')
}

function slugify(str) {
  return String(str).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40)
}
