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
  zone:        'Zone & Minimum Lot Size',
  flood:       'Flood Overlay',
  elevation:   'Slope & Elevation',
  stormwater:  'Stormwater Infrastructure',
  character:   'Character Overlay',
  lotsize:     'Lot Size Viability'
}

async function generatePdf({ address, feasibility, parcel }) {
  return new Promise(async (resolve, reject) => {
    try {
      const doc = new PDFDocument({
        size: 'A4',
        margin: 50,
        info: {
          Title: `SubdivideIQ Report — ${address}`,
          Author: 'SubdivideIQ',
          Subject: 'Subdivision Feasibility Pre-Screen'
        }
      })

      const chunks = []
      doc.on('data', c => chunks.push(c))
      doc.on('end', () => resolve(Buffer.concat(chunks)))
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

      // ── HEADER ──────────────────────────────────────────────────────────────
      doc.fontSize(22).fillColor('#1e293b').font('Helvetica-Bold')
        .text('SubdivideIQ', 50, 50)

      doc.fontSize(9).fillColor('#64748b').font('Helvetica')
        .text('Subdivision Feasibility Pre-Screen', 50, 76)

      // Address + date (right-aligned)
      doc.fontSize(9).fillColor('#374151').font('Helvetica')
        .text(generatedAt, 50, 50, { align: 'right' })
      doc.fontSize(11).fillColor('#1e293b').font('Helvetica-Bold')
        .text(address, 50, 64, { align: 'right' })

      // Horizontal rule
      doc.moveTo(50, 100).lineTo(545, 100).strokeColor('#e2e8f0').lineWidth(1).stroke()

      // ── LOT MAP (Mapbox Static API) ──────────────────────────────────────────
      let mapY = 115
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
