/**
 * check-infrastructure.js — BCC Infrastructure Charge Estimator
 *
 * POST /api/check-infrastructure
 * Body: { lat, lng, zone_code, suburb }
 *
 * Estimates the BCC infrastructure charge that will apply when a new lot is created.
 * Infrastructure charges are a mandatory levy payable at DA approval — typically
 * $28,000–$32,000 per additional lot in Urban Brisbane (2026 estimates).
 *
 * Data source: BCC Infrastructure Charges Resolution (ICR), updated quarterly.
 * Charge schedule: /data/infrastructure-charges.json
 *
 * Flag logic:
 *   GREEN  — charge estimable and within typical range
 *   AMBER  — charge estimable but significant (>$30k) — include in budget planning
 *   RED    — not used for infrastructure charges (it's a known cost, not a constraint)
 *
 * Note: This check always returns AMBER to flag the charge in the report.
 * The charge is not a RED flag because it is a fixed, known cost — not a constraint
 * that prevents subdivision.
 */

const path = require('path')
const fs   = require('fs')

const CHARGES = JSON.parse(
  fs.readFileSync(path.join(__dirname, '../data/infrastructure-charges.json'), 'utf8')
)

function getChargeArea(suburb) {
  if (!suburb) return 'URBAN'
  const s = suburb.toUpperCase().trim()
  if (CHARGES.known_township_suburbs.includes(s)) return 'TOWNSHIP'
  return 'URBAN'
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', process.env.ALLOWED_ORIGIN || '*')
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const { lat, lng, suburb, zone_code } = req.body || {}

  const chargeArea    = getChargeArea(suburb)
  const areaSchedule  = CHARGES.charge_areas[chargeArea]
  const chargePerLot  = areaSchedule?.residential_per_additional_lot?.low_density_house
                     || CHARGES.default_charge.min
  const chargeLabel   = areaSchedule?.label || CHARGES.default_charge.label

  const formatted = '$' + chargePerLot.toLocaleString('en-AU')

  return res.json({
    check: 'infrastructure',
    status: 'ESTIMATED',
    flag: 'AMBER',
    message: `Infrastructure charge estimate: ${formatted} per additional lot (BCC Urban Area, 2026).`,
    plain_english: `Infrastructure charges are a mandatory BCC levy on new lots — payable at DA approval, not at settlement. Based on your location (${chargeLabel}), expect approximately ${formatted} per new lot created. This is in addition to DA fees, survey costs, and headworks.`,
    cost_time_implication: `${formatted} per additional lot — payable at DA approval. Budget this as a fixed cost before your DA is submitted.`,
    estimated_charge_per_lot: chargePerLot,
    charge_area: chargeArea,
    charge_area_label: chargeLabel,
    charge_source: 'BCC Infrastructure Charges Resolution (indicative 2026)',
    charge_source_url: 'https://www.brisbane.qld.gov.au/planning-and-building/development-standards-and-process/infrastructure-charges',
    gst_exclusive: true,
    note: 'Confirm current charge with BCC before budgeting — rates are updated quarterly.'
  })
}
