/**
 * report-status.js — Poll subdivide_reports for a session result
 *
 * GET /api/report-status?session_id=cs_...
 *
 * Returns:
 *   { status: 'PENDING' }
 *   { status: 'GREEN'|'AMBER'|'RED'|'ERROR', address, flags }
 */

const { createClient } = require('@supabase/supabase-js')

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', (process.env.ALLOWED_ORIGIN || '*').trim())
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

  const { session_id } = req.query
  if (!session_id) return res.status(400).json({ error: 'session_id required' })

  const db = createClient(
    process.env.SUPABASE_URL || 'https://fzykfxesznyiigoyeyed.supabase.co',
    process.env.SUPABASE_SERVICE_KEY
  )

  // Use limit(1) + order instead of .single() — .single() throws PGRST116 if Stripe
  // retried the webhook and created duplicate rows for the same session_id.
  const { data: rows, error } = await db
    .from('subdivide_reports')
    .select('result, address, flags, created_at')
    .eq('stripe_session_id', session_id)
    .order('created_at', { ascending: false })
    .limit(1)

  const data = rows?.[0]
  if (error || !data) {
    return res.json({ status: 'PENDING' })
  }

  return res.json({
    status:  data.result || 'PENDING',
    address: data.address,
    flags:   data.flags  || {}
  })
}
