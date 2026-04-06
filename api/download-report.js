/**
 * download-report.js — PDF download endpoint for SubdivideIQ
 *
 * GET /api/download-report?session_id=xxx
 *
 * Looks up stored feasibility data in Supabase for the given Stripe session ID,
 * regenerates the PDF on-demand, and streams it as an attachment.
 *
 * Security note: session_id is Stripe-generated (cs_live_xxx) — not guessable.
 * No additional auth required for now.
 */

const { createClient } = require('@supabase/supabase-js')
const { generatePdf }  = require('./generate-pdf')

function getSupabase() {
  return createClient(
    process.env.SUPABASE_URL || 'https://fzykfxesznyiigoyeyed.supabase.co',
    process.env.SUPABASE_SERVICE_KEY
  )
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', (process.env.ALLOWED_ORIGIN || '*').trim())
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

  const sessionId = req.query?.session_id
  if (!sessionId) return res.status(400).json({ error: 'session_id required' })

  const db = getSupabase()

  // Fetch report from Supabase
  const { data: rows, error } = await db
    .from('subdivide_reports')
    .select('address, result, flags, created_at')
    .eq('stripe_session_id', sessionId)
    .order('created_at', { ascending: false })
    .limit(1)

  if (error || !rows?.length) {
    return res.status(404).json({ error: 'Report not found' })
  }

  const row = rows[0]

  if (!row.result || row.result === 'PENDING' || row.result === 'ERROR') {
    return res.status(404).json({ error: 'Report not yet available', status: row.result })
  }

  // Reconstruct feasibility object from stored flags
  const flags = row.flags || {}
  const feasibility = {
    overall: flags.overall || { flag: row.result, summary: '' },
    checks:  flags.checks  || {},
    what_to_do_next: [],
    cost_range: {},
    address_meta: {}
  }

  // Parcel data from stored lot info
  const parcel = flags.lot ? {
    lot:     flags.lot.lot,
    plan:    flags.lot.plan,
    area_m2: flags.lot.area_m2
  } : null

  try {
    const pdfBuffer = await generatePdf({
      address: row.address || 'Address not recorded',
      feasibility,
      parcel
    })

    const filename = `SubdivideIQ-Report-${slugify(row.address || 'report')}.pdf`
    res.setHeader('Content-Type', 'application/pdf')
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`)
    res.setHeader('Content-Length', pdfBuffer.length)
    res.status(200).end(pdfBuffer)
  } catch (err) {
    console.error('[download-report] PDF generation failed:', err.message)
    return res.status(500).json({ error: 'PDF generation failed' })
  }
}

function slugify(str) {
  return String(str).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40)
}
