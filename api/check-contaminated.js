/**
 * check-contaminated.js — QLD Contaminated Land check
 *
 * POST /api/check-contaminated
 * Body: { lat, lng }
 *
 * Queries the QLD Environmental Management Register (EMR) and Contaminated Land
 * Register (CLR) for sites within or near the lot.
 *
 * Data source: QLD DES — no public coordinate-based API exists (as of April 2026).
 * The EMR/CLR is searchable via address only at environment.des.qld.gov.au.
 *
 * Implementation:
 *   - Returns AMBER flag with note to check QLD DES portal manually
 *   - If future API becomes available, replace the stub with live lookup
 *
 * Flag logic:
 *   GREEN  — No known contamination (requires API, not yet available)
 *   AMBER  — Manual check required — QLD EMR/CLR has no public spatial API
 *   RED    — Confirmed on register (requires API)
 */

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', process.env.ALLOWED_ORIGIN || '*')
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const { lat, lng } = req.body || {}
  if (!lat || !lng) return res.status(400).json({ error: 'lat and lng required', check: 'contaminated', flag: 'AMBER' })

  // QLD EMR/CLR has no public coordinate-based API (confirmed April 2026).
  // DES provides address-based search only at environment.des.qld.gov.au.
  // Return AMBER with clear instructions for manual verification.

  return res.json({
    check: 'contaminated',
    status: 'UNVERIFIED',
    flag: 'AMBER',
    message: 'Contaminated land register not automatically checked — manual verification required.',
    plain_english: 'The QLD Environmental Management Register (EMR) and Contaminated Land Register (CLR) could not be automatically checked for this lot. A contaminated site can significantly increase costs or render a subdivision unviable. You should verify manually before proceeding.',
    cost_time_implication: 'If contamination is found: environmental assessment $5,000–$20,000+; remediation costs can exceed lot value.',
    manual_check_url: 'https://environment.des.qld.gov.au/management/land/contaminated-land',
    manual_check_instructions: 'Search by address on the QLD DES portal. Look for EMR or CLR listings at or near your lot.',
    api_gap: true,
    api_gap_note: 'QLD DES does not provide a public coordinate-based spatial API for the EMR/CLR as of April 2026.'
  })
}
