/**
 * check-character.js — Character overlay check
 *
 * POST /api/check-character
 * Body: { lat, lng }
 *
 * Queries character_overlays in Supabase.
 * Character overlays affect demolition controls on the existing dwelling.
 *
 * Implications for subdivision:
 *   - If in character overlay: demolition of existing dwelling may require
 *     building approval and compliance with character requirements
 *   - "Dwelling house character" overlay: new dwelling must be sympathetic to
 *     the character of the existing streetscape (affects rear lot design)
 *   - Pre-1946 built character overlay: additional requirements for existing building
 *
 * This check does NOT block subdivision — it's an AMBER flag if overlay present,
 * informational if not.
 */

const { getClient } = require('./lib/db')

// Map character types to plain English notes
const CHARACTER_NOTES = {
  'Dwelling house character': 'The existing dwelling and any new dwelling on the rear lot must respect the character of the street. New builds must use compatible materials, roof pitch, and form. Demolition of the existing dwelling may require building approval.',
  'Pre-1946 building character': 'This lot is subject to pre-1946 character controls. The existing building may have heritage-like protections. Demolition requires assessment — consult a town planner before assuming the dwelling can be removed.',
  default: 'Character overlay applies — the design of any new dwelling must respect the established character of the area. A town planner can advise on design compliance.'
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).end()

  const { lat, lng } = req.body || {}
  if (!lat || !lng) return res.status(400).json({ error: 'lat and lng required' })

  const client = getClient()
  try {
    await client.connect()

    const result = await client.query(
      `SELECT character_type
       FROM character_overlays
       WHERE ST_Contains(
         geometry,
         ST_SetSRID(ST_MakePoint($1, $2), 4326)
       )
       LIMIT 5`,
      [lng, lat]
    )

    if (result.rows.length === 0) {
      return res.json({
        check: 'character',
        status: 'NONE',
        flag: 'GREEN',
        in_character_overlay: false,
        overlay_name: null,
        demolition_note: null,
        message: 'No character overlay identified on this lot',
        plain_english: 'No character overlay applies. No additional design requirements for the new rear lot dwelling.',
        cost_time_implication: null
      })
    }

    const overlayNames = result.rows.map(r => r.character_type).filter(Boolean)
    const primaryOverlay = overlayNames[0]
    const note = CHARACTER_NOTES[primaryOverlay] || CHARACTER_NOTES.default

    return res.json({
      check: 'character',
      status: 'OVERLAY_PRESENT',
      flag: 'AMBER',
      in_character_overlay: true,
      overlay_name: primaryOverlay,
      overlay_names: overlayNames,
      demolition_note: note,
      message: `Character overlay (${primaryOverlay}) applies to this lot`,
      plain_english: note,
      cost_time_implication: 'Town planner review recommended for character compliance ($1,500–$3,000). May affect rear lot dwelling design.'
    })
  } catch (err) {
    console.error('check-character error:', err.message)
    return res.status(500).json({ error: 'Character check failed', check: 'character', flag: 'AMBER' })
  } finally {
    await client.end()
  }
}
