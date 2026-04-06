/**
 * generate-pdf.js — SubdivideIQ PDF feasibility report generator
 *
 * Usage (internal):
 *   const { generatePdf } = require('./generate-pdf')
 *   const pdfBuffer = await generatePdf({ address, feasibility, parcel })
 *
 * Uses pdfkit (pure Node.js — no Chromium, works in Vercel serverless).
 *
 * Layout:
 *   1. Header: SubdivideIQ + address + date
 *   2. Lot map: Mapbox Static API image (if MAPBOX_TOKEN available)
 *   3. Traffic light: large coloured panel + summary
 *   4. Per-check sections (zone, flood, elevation, stormwater, character, lotsize)
 *   5. "What to do next" consultant sequence
 *   6. Consultant cost reference table
 *   7. Disclaimer footer
 */

const PDFDocument = require('pdfkit')

const FLAG_COLOURS = {
  GREEN: { bg: '#16a34a', text: '#ffffff', label: 'GREEN — LIKELY VIABLE' },
  AMBER: { bg: '#d97706', text: '#ffffff', label: 'AMBER — PROCEED WITH CAUTION' },
  RED:   { bg: '#dc2626', text: '#ffffff', label: 'RED — SIGNIFICANT CONSTRAINT' }
}

const CHECK_LABELS = {
  zone:          'Zone & Minimum Lot Size',
  flood:         'Flood Overlay',
  elevation:     'Slope & Elevation',
  stormwater:    'Stormwater Infrastructure',
  character:     'Character Overlay',
  lotsize:       'Lot Size Viability',
  contaminated:  'Contaminated Land Register',
  infrastructure:'Infrastructure Charges',
  easements:     'Powerline Easements',
  acidsulfate:   'Acid Sulfate Soils'
}

async function generatePdf({ address, feasibility, parcel }) {
  return new Promise(async (resolve, reject) => {
    try {
      const doc = new PDFDocument({
        size: 'A4',
        margin: 50,
        bufferPages: true,
        info: {
          Title: `SubdivideIQ Report — ${address}`,
          Author: 'SubdivideIQ',
          Subject: 'Subdivision Feasibility Pre-Screen'
        }
      })

      const chunks = []
      doc.on('data', c => chunks.push(c))
      doc.on('error', reject)

      const overall = feasibility?.overall || {}
      const checks  = feasibility?.checks  || {}
      const next    = feasibility?.what_to_do_next || []
      const costs   = feasibility?.cost_range || {}
      const flag    = overall.flag || 'AMBER'
      const colours = FLAG_COLOURS[flag] || FLAG_COLOURS.AMBER

      const pageW = doc.page.width - 100 // content width (50px margins each side)
      const generatedAt = new Date().toLocaleDateString('en-AU', {
        day: '2-digit', month: 'long', year: 'numeric'
      })

      // ── COVER HEADER ─────────────────────────────────────────────────────────
      // Brand bar
      doc.rect(0, 0, doc.page.width, 56).fill('#0f172a')
      doc.fontSize(22).fillColor('#ffffff').font('Helvetica-Bold')
        .text('SubdivideIQ', 50, 16)
      doc.fontSize(9).fillColor('#94a3b8').font('Helvetica')
        .text('Subdivision Feasibility Pre-Screen', 50, 40)
      doc.fontSize(9).fillColor('#94a3b8').font('Helvetica')
        .text(generatedAt, 50, 40, { align: 'right' })

      // Address block
      doc.fontSize(14).fillColor('#0f172a').font('Helvetica-Bold')
        .text(address, 50, 72, { width: pageW })

      // Horizontal rule
      doc.moveTo(50, 94).lineTo(545, 94).strokeColor('#e2e8f0').lineWidth(1).stroke()

      // ── LOT MAP (Mapbox Static API) ──────────────────────────────────────────
      let mapY = 108
      const MAPBOX_TOKEN = process.env.MAPBOX_TOKEN
      if (MAPBOX_TOKEN && parcel?.centroid_lat && parcel?.centroid_lng) {
        try {
          const mapUrl = buildMapUrl(parcel, MAPBOX_TOKEN)
          const imgRes = await fetch(mapUrl, { signal: AbortSignal.timeout(8000) })
          if (imgRes.ok) {
            const imgBuf = Buffer.from(await imgRes.arrayBuffer())
            doc.image(imgBuf, 50, mapY, { width: pageW, height: 180 })
            mapY += 190
          }
        } catch (e) {
          // Map fetch failed — skip image, note it
          doc.fontSize(8).fillColor('#94a3b8').text('(Map unavailable)', 50, mapY)
          mapY += 14
        }
      }

      // ── TRAFFIC LIGHT RESULT ─────────────────────────────────────────────────
      const tlH = 64
      doc.roundedRect(50, mapY, pageW, tlH, 8)
        .fill(colours.bg)

      doc.fontSize(24).fillColor(colours.text).font('Helvetica-Bold')
        .text(colours.label, 50, mapY + 10, { width: pageW, align: 'center' })

      doc.fontSize(10).fillColor(colours.text).font('Helvetica')
        .text(overall.summary || '', 50, mapY + 38, { width: pageW, align: 'center' })

      let y = mapY + tlH + 18

      // Red/Amber/Green count pills
      const pillY = y
      const pillData = [
        { label: 'RED',   count: overall.red_count   || 0, colour: '#dc2626' },
        { label: 'AMBER', count: overall.amber_count || 0, colour: '#d97706' },
        { label: 'GREEN', count: overall.green_count || 0, colour: '#16a34a' }
      ]
      let pillX = 50
      for (const p of pillData) {
        const txt = `${p.count} ${p.label}`
        doc.roundedRect(pillX, pillY, 90, 20, 4).fill(p.colour)
        doc.fontSize(9).fillColor('#ffffff').font('Helvetica-Bold')
          .text(txt, pillX, pillY + 5, { width: 90, align: 'center' })
        pillX += 98
      }

      y = pillY + 32

      // ── KEY NUMBERS BLOCK ─────────────────────────────────────────────────────
      if (y > doc.page.height - 180) { doc.addPage(); y = 50 }
      y += 4
      doc.fontSize(11).fillColor('#0f172a').font('Helvetica-Bold')
        .text('Key Numbers', 50, y)
      y += 14

      const keyNumbers = []
      const areaM2 = parcel?.area_m2 || feasibility?.address_meta?.area_m2
      if (areaM2) {
        keyNumbers.push(['Lot area', `${Math.round(areaM2).toLocaleString()}m\u00b2`])
      }
      if (checks.zone?.zone_name) {
        keyNumbers.push(['Zone', checks.zone.zone_name])
      }
      if (checks.zone?.council) {
        const cn = checks.zone.council
        keyNumbers.push(['Council', cn.charAt(0).toUpperCase() + cn.slice(1)])
      }
      if (checks.zone?.min_lot_size_m2) {
        keyNumbers.push(['Min lot size (zone)', `${checks.zone.min_lot_size_m2}m\u00b2`])
      }
      // Best indicative split
      if (checks.lotsize?.option_a_60_40?.viable) {
        const a = checks.lotsize.option_a_60_40
        keyNumbers.push(['Indicative split (60/40)', `${a.front_lot_m2}m\u00b2 front / ${a.rear_lot_m2}m\u00b2 rear`])
      } else if (checks.lotsize?.option_b_50_50?.viable) {
        const b = checks.lotsize.option_b_50_50
        keyNumbers.push(['Indicative split (50/50)', `${b.front_lot_m2}m\u00b2 front / ${b.rear_lot_m2}m\u00b2 rear`])
      }
      // Buffer above minimum
      if (checks.zone?.min_lot_size_m2 && areaM2) {
        const buffer = Math.round(areaM2) - 2 * checks.zone.min_lot_size_m2
        keyNumbers.push(['Buffer above minimum', buffer >= 0 ? `+${buffer}m\u00b2` : `${buffer}m\u00b2 (shortfall)`])
      }
      // Infrastructure charge
      if (checks.infrastructure?.estimated_charge_per_lot) {
        keyNumbers.push(['Infrastructure charge (est.)', `$${checks.infrastructure.estimated_charge_per_lot.toLocaleString('en-AU')} per new lot`])
      }
      keyNumbers.push(['SubdivideIQ pre-screen saved', '~$7,500 in consultant fees'])

      // Render as simple key-value rows
      for (let i = 0; i < keyNumbers.length; i++) {
        if (y > doc.page.height - 50) { doc.addPage(); y = 50 }
        const rowH = 17
        if (i % 2 === 0) doc.rect(50, y, pageW, rowH).fill('#f8fafc')
        doc.fontSize(8).fillColor('#6b7280').font('Helvetica')
          .text(keyNumbers[i][0], 56, y + 4, { width: pageW / 2 - 10 })
        doc.fontSize(8).fillColor('#0f172a').font('Helvetica-Bold')
          .text(keyNumbers[i][1], 56 + pageW / 2, y + 4, { width: pageW / 2 - 10, align: 'right' })
        y += rowH
      }
      y += 10

      // ── PER-CHECK SECTIONS ───────────────────────────────────────────────────
      doc.fontSize(13).fillColor('#0f172a').font('Helvetica-Bold')
        .text('Feasibility Check Results', 50, y)
      y += 20

      for (const [key, check] of Object.entries(checks)) {
        if (!check) continue
        const label   = CHECK_LABELS[key] || key
        const chFlag  = check.flag || 'AMBER'
        const chColour = FLAG_COLOURS[chFlag] || FLAG_COLOURS.AMBER

        // Add page if needed
        if (y > doc.page.height - 200) {
          doc.addPage()
          y = 50
        }

        // Section header with colour badge
        doc.roundedRect(50, y, 55, 16, 3).fill(chColour.bg)
        doc.fontSize(8).fillColor('#ffffff').font('Helvetica-Bold')
          .text(chFlag, 50, y + 4, { width: 55, align: 'center' })

        doc.fontSize(11).fillColor('#0f172a').font('Helvetica-Bold')
          .text(label, 112, y)

        y += 22

        // Plain English explanation
        const msg = check.plain_english || check.message || ''
        if (msg) {
          doc.fontSize(9).fillColor('#374151').font('Helvetica')
            .text(msg, 50, y, { width: pageW })
          y += doc.heightOfString(msg, { width: pageW }) + 4
        }

        // Cost/time implication
        const cost = check.cost_time_implication
        if (cost) {
          doc.fontSize(8).fillColor('#92400e').font('Helvetica-Bold')
            .text('Cost/time: ', 50, y, { continued: true })
          doc.fontSize(8).fillColor('#92400e').font('Helvetica')
            .text(cost, { continued: false })
          y += 14
        }

        // Divider
        doc.moveTo(50, y + 4).lineTo(545, y + 4).strokeColor('#f1f5f9').lineWidth(0.5).stroke()
        y += 14
      }

      // ── WHAT TO DO NEXT ───────────────────────────────────────────────────────
      if (y > doc.page.height - 250) {
        doc.addPage()
        y = 50
      }

      y += 8
      doc.fontSize(13).fillColor('#0f172a').font('Helvetica-Bold')
        .text('What to do next', 50, y)
      y += 18

      for (const step of next) {
        if (y > doc.page.height - 150) {
          doc.addPage()
          y = 50
        }

        doc.fontSize(10).fillColor('#2563eb').font('Helvetica-Bold')
          .text(`Step ${step.step}: ${step.who}`, 50, y)
        y += 14

        doc.fontSize(9).fillColor('#374151').font('Helvetica')
          .text(step.why, 62, y, { width: pageW - 12 })
        y += doc.heightOfString(step.why, { width: pageW - 12 }) + 2

        doc.fontSize(8).fillColor('#6b7280').font('Helvetica')
          .text(`Cost: ${step.cost}`, 62, y)
        y += 16
      }

      // ── CONSULTANT COST REFERENCE TABLE ──────────────────────────────────────
      if (y > doc.page.height - 220) {
        doc.addPage()
        y = 50
      }

      y += 8
      doc.fontSize(11).fillColor('#0f172a').font('Helvetica-Bold')
        .text('Consultant cost reference (Brisbane, 2026 estimates)', 50, y)
      y += 16

      const costTable = [
        ['Town planner — feasibility opinion',  '$500–$1,500'],
        ['Town planner — full DA preparation',  '$1,500–$3,000'],
        ['Land surveyor — plan of subdivision', '$2,000–$4,000'],
        ['Hydraulics engineer (RPEQ-signed)',   '$4,000–$8,000'],
        ['Geotechnical report (if steep slope)','$3,000–$6,000'],
        ['Development application (DA) fees',   '$3,000–$8,000'],
        ['Infrastructure charges (BCC)',        '$20,000–$30,000 per new lot']
      ]

      // Table header
      doc.rect(50, y, pageW, 18).fill('#f8fafc')
      doc.fontSize(8).fillColor('#374151').font('Helvetica-Bold')
        .text('Consultant / Fee', 56, y + 5)
        .text('Indicative Cost',  430, y + 5)
      y += 18

      for (let i = 0; i < costTable.length; i++) {
        const [service, cost] = costTable[i]
        const rowH = 16
        if (i % 2 === 0) doc.rect(50, y, pageW, rowH).fill('#f9fafb')
        doc.fontSize(8).fillColor('#1e293b').font('Helvetica')
          .text(service, 56, y + 4, { width: 360 })
          .text(cost,    430, y + 4)
        y += rowH
      }

      // Total range
      if (costs.low || costs.high) {
        y += 4
        doc.rect(50, y, pageW, 22).fill('#f0fdf4')
        doc.fontSize(9).fillColor('#166534').font('Helvetica-Bold')
          .text(`Indicative total (pre-construction): ${costs.low || ''}–${costs.high || ''}`, 56, y + 7)
        y += 28
      }

      // ── DATA SOURCES & SCOPE ─────────────────────────────────────────────────
      if (y > doc.page.height - 220) { doc.addPage(); y = 50 }
      y += 8
      doc.fontSize(11).fillColor('#0f172a').font('Helvetica-Bold')
        .text('What SubdivideIQ Checked — and What It Didn\'t', 50, y)
      y += 14

      const dataSources = [
        ['Zone & lot size', 'ZoneIQ Supabase / QLD DCDB', 'All SEQ (7 councils)'],
        ['Flood overlay', 'BCC City Plan (Supabase) + QFAO fallback', 'All SEQ + QFAO state fallback'],
        ['Slope & elevation', 'QLD DEM via ArcGIS ImageServer', 'All of Queensland'],
        ['Stormwater infrastructure', 'BCC pipe & drain data (Supabase)', 'Brisbane metro only'],
        ['Character overlay', 'ZoneIQ Supabase', 'Brisbane only'],
        ['Contaminated land', 'Not checked (no free spatial API)', 'Manual check required'],
        ['Infrastructure charges', 'BCC ICR 2026 / council estimate', 'BCC exact; others indicative'],
        ['Powerline easements', 'BCC City Plan ArcGIS', 'Brisbane only'],
        ['Acid sulfate soils', 'BCC City Plan ArcGIS', 'Brisbane only'],
      ]

      // Table header
      doc.rect(50, y, pageW, 16).fill('#f1f5f9')
      doc.fontSize(7).fillColor('#374151').font('Helvetica-Bold')
        .text('Check', 56, y + 5)
        .text('Data Source', 185, y + 5)
        .text('Coverage', 380, y + 5)
      y += 16

      for (let i = 0; i < dataSources.length; i++) {
        if (y > doc.page.height - 50) { doc.addPage(); y = 50 }
        const rowH = 14
        if (i % 2 === 0) doc.rect(50, y, pageW, rowH).fill('#f9fafb')
        doc.fontSize(7).fillColor('#1e293b').font('Helvetica')
          .text(dataSources[i][0], 56,  y + 4, { width: 125 })
          .text(dataSources[i][1], 185, y + 4, { width: 185 })
          .text(dataSources[i][2], 380, y + 4, { width: 155 })
        y += rowH
      }

      y += 6
      const notChecked = [
        'What SubdivideIQ did NOT check: development applications (PD Online), sewerage & water headworks, road frontage easements on title, body corporate or covenant restrictions, building envelope restrictions.'
      ]
      doc.fontSize(7).fillColor('#64748b').font('Helvetica')
        .text(notChecked[0], 50, y, { width: pageW })
      y += doc.heightOfString(notChecked[0], { width: pageW }) + 4

      // ── DISCLAIMER FOOTER ─────────────────────────────────────────────────────
      if (y > doc.page.height - 120) {
        doc.addPage()
        y = 50
      }

      y += 16
      doc.moveTo(50, y).lineTo(545, y).strokeColor('#e2e8f0').lineWidth(1).stroke()
      y += 10

      const disclaimer = [
        'DISCLAIMER — NOT ENGINEERING OR LEGAL ADVICE',
        'This report is a pre-screen intelligence tool only. It does not constitute engineering advice, legal advice, or a formal feasibility assessment.',
        'It is not a replacement for: a hydraulics report (RPEQ-signed, legally required for flood-affected lots), a cadastral survey, or a town planner assessment.',
        'SubdivideIQ is an inspector, not an engineer. Think of this report as a building pre-purchase inspection — it tells you whether to bother paying the engineer.',
        'Always engage qualified professionals before making development or financial decisions. Information is based on publicly available data and may not reflect recent amendments.',
        'Coverage: SubdivideIQ currently covers all of South East Queensland (Brisbane, Gold Coast, Moreton Bay, Sunshine Coast, Ipswich, Logan and Redland councils). Other QLD councils use state-level data where available.',
        'SubdivideIQ Pty Ltd accepts no liability for decisions made based on this report.'
      ]

      doc.fontSize(7).fillColor('#6b7280').font('Helvetica-Bold')
        .text(disclaimer[0], 50, y)
      y += 12

      for (const line of disclaimer.slice(1)) {
        doc.fontSize(7).fillColor('#6b7280').font('Helvetica')
          .text(line, 50, y, { width: pageW })
        y += doc.heightOfString(line, { width: pageW }) + 3
      }

      // ── PAGE NUMBERS ─────────────────────────────────────────────────────────
      const range = doc.bufferedPageRange()
      const totalPages = range.count
      for (let i = 0; i < totalPages; i++) {
        doc.switchToPage(i)
        doc.fontSize(7).fillColor('#94a3b8').font('Helvetica')
          .text(
            `SubdivideIQ — ${address} — Page ${i + 1} of ${totalPages}`,
            50, doc.page.height - 28,
            { width: pageW, align: 'center' }
          )
      }

      doc.on('end', () => resolve(Buffer.concat(chunks)))
      doc.flushPages()
      doc.end()
    } catch (err) {
      reject(err)
    }
  })
}

function buildMapUrl(parcel, token) {
  const lat = parcel.centroid_lat
  const lng = parcel.centroid_lng
  const zoom = 17
  const w = 800
  const h = 360
  const pin = `pin-l-home+2563eb(${lng},${lat})`
  return `https://api.mapbox.com/styles/v1/mapbox/streets-v12/static/${pin}/${lng},${lat},${zoom},0/${w}x${h}@2x?access_token=${token}`
}

module.exports = { generatePdf }
