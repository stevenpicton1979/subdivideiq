/**
 * check-lotsize.js — Lot size viability and split analysis
 *
 * POST /api/check-lotsize
 * Body: { lat, lng, geom_geojson, area_m2, min_lot_size_m2 }
 *
 * Calculates indicative lot split options:
 *   Option A: 60/40 front/rear split (standard rear lot subdivision)
 *   Option B: Battle-axe (rear lot with access handle)
 *
 * Also estimates frontage width from lot polygon geometry.
 *
 * Status:
 *   VIABLE    — both options produce compliant lots
 *   MARGINAL  — one option viable, one marginal
 *   BATTLE_AXE_ONLY — front/rear fails but battle-axe viable
 *   NOT_VIABLE — neither option meets minimum
 */

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).end()

  const { lat, lng, geom_geojson, area_m2, min_lot_size_m2 } = req.body || {}
  if (!area_m2) return res.status(400).json({ error: 'area_m2 required' })

  const minLot = min_lot_size_m2 || 600 // BCC LDR default
  const totalArea = parseFloat(area_m2)

  // Derive lot dimensions from polygon or estimate
  const dims = deriveDimensions(lat, lng, geom_geojson, totalArea)
  const { frontageWidth, depth, isDeep } = dims

  // Option A: 60/40 front/rear split
  // Front lot gets 60% (includes existing dwelling), rear lot gets 40%
  // For a battle-axe, the access handle (3m × depth) reduces rear lot area
  const frontLotA = totalArea * 0.60
  const rearLotA = totalArea * 0.40

  // Option B: 50/50 split (more balanced, sometimes preferred by council)
  const frontLotB = totalArea * 0.50
  const rearLotB = totalArea * 0.50

  // Battle-axe analysis
  // A battle-axe requires an access handle — typically 3m wide × lot depth
  // This handle area is subtracted from the rear lot
  const handleWidth = 3 // metres minimum BCC requirement
  const handleArea = handleWidth * depth
  const rearBattleAxe = totalArea * 0.40 - handleArea
  const battleAxeViable =
    frontageWidth >= (handleWidth + 6) && // enough frontage for handle + dwelling
    rearBattleAxe >= minLot

  // Frontage check
  // BCC LDR requires minimum 7.5m frontage for standard lot
  // Battle-axe handle minimum 3m
  const frontageOk = frontageWidth >= 7.5
  const battleAxeFrontageOk = frontageWidth >= (handleWidth + 6)

  // Evaluate A (60/40)
  const optionAFrontOk = frontLotA >= minLot
  const optionARearOk = rearLotA >= minLot
  const optionAViable = optionAFrontOk && optionARearOk && frontageOk

  // Evaluate B (50/50)
  const optionBFrontOk = frontLotB >= minLot
  const optionBRearOk = rearLotB >= minLot
  const optionBViable = optionBFrontOk && optionBRearOk && frontageOk

  // Overall status
  let status, flag, message

  if (optionAViable || optionBViable) {
    status = 'VIABLE'
    flag = 'GREEN'
    const bestFront = optionAViable ? Math.round(frontLotA) : Math.round(frontLotB)
    const bestRear = optionAViable ? Math.round(rearLotA) : Math.round(rearLotB)
    message = `Lot size (${Math.round(totalArea)}m²) supports a two-lot subdivision. Indicative split: ${bestFront}m² front / ${bestRear}m² rear — both above the ${minLot}m² minimum.`
  } else if (battleAxeViable) {
    status = 'BATTLE_AXE_ONLY'
    flag = 'AMBER'
    message = `Standard front/rear split may not produce two compliant lots (${Math.round(rearLotA)}m² rear < ${minLot}m² minimum). However, a battle-axe configuration (rear lot with access strip) may be viable — consult a town planner.`
  } else {
    const halfLot = Math.round(totalArea / 2)
    if (halfLot >= minLot * 0.75) {
      // Marginal — a creative split, battle-axe, or reconfiguration may still work
      status = 'MARGINAL'
      flag = 'AMBER'
      message = `Lot area (${Math.round(totalArea)}m²) is close to the minimum needed for two ${minLot}m² lots. A creative split or battle-axe may work — a town planner can advise.`
    } else {
      // Hard blocker — no realistic configuration produces two compliant lots
      status = 'NOT_VIABLE'
      flag = 'RED'
      message = `Lot area (${Math.round(totalArea)}m²) is insufficient to produce two lots meeting the ${minLot}m² minimum in this zone. Subdivision is not viable on this lot size.`
    }
  }

  return res.json({
    check: 'lotsize',
    status,
    flag,
    message,
    plain_english: message,
    cost_time_implication: flag === 'GREEN' ? null : 'Town planner consultation recommended ($1,500–$3,000) to determine viable split configuration.',
    total_area_m2: Math.round(totalArea),
    min_lot_size_m2: minLot,
    frontage_width_m: parseFloat(frontageWidth.toFixed(1)),
    depth_m: parseFloat(depth.toFixed(1)),
    frontage_ok: frontageOk,
    option_a_60_40: {
      front_lot_m2: Math.round(frontLotA),
      rear_lot_m2: Math.round(rearLotA),
      front_ok: optionAFrontOk,
      rear_ok: optionARearOk,
      viable: optionAViable
    },
    option_b_50_50: {
      front_lot_m2: Math.round(frontLotB),
      rear_lot_m2: Math.round(rearLotB),
      front_ok: optionBFrontOk,
      rear_ok: optionBRearOk,
      viable: optionBViable
    },
    battle_axe: {
      viable: battleAxeViable,
      rear_lot_m2: Math.max(0, Math.round(rearBattleAxe)),
      handle_width_m: handleWidth,
      handle_area_m2: Math.round(handleArea),
      frontage_ok: battleAxeFrontageOk,
      note: battleAxeViable
        ? 'Battle-axe configuration appears viable. A surveyor can confirm handle dimensions.'
        : battleAxeFrontageOk
          ? 'Battle-axe not viable — rear lot area insufficient after access handle deduction.'
          : 'Battle-axe not viable — insufficient frontage for 3m access handle.'
    },
    split_viable: optionAViable || optionBViable,
    dimensions_source: geom_geojson ? 'polygon_derived' : 'estimated'
  })
}

/**
 * Derive frontage width and depth from lot polygon.
 * Returns { frontageWidth, depth, isDeep }
 */
function deriveDimensions(lat, lng, geom_geojson, area_m2) {
  if (geom_geojson) {
    try {
      const bbox = computeBbox(geom_geojson)
      if (bbox) {
        const [minLng, minLat, maxLng, maxLat] = bbox
        const refLat = lat || (minLat + maxLat) / 2
        const widthM = Math.abs(maxLng - minLng) * 111320 * Math.cos(refLat * Math.PI / 180)
        const heightM = Math.abs(maxLat - minLat) * 110540
        // Frontage = shorter dimension (typically), depth = longer
        const frontage = Math.min(widthM, heightM)
        const depth = Math.max(widthM, heightM)
        return { frontageWidth: frontage, depth, isDeep: depth > frontage * 2 }
      }
    } catch {}
  }

  // Fallback: estimate from area assuming typical lot proportions (1:2 ratio)
  // area = frontage × depth, depth ≈ 2 × frontage → frontage = sqrt(area/2)
  const frontage = Math.sqrt(area_m2 / 2)
  const depth = area_m2 / frontage
  return { frontageWidth: frontage, depth, isDeep: true }
}

function computeBbox(geom_geojson) {
  try {
    let coords = []
    const geom = geom_geojson.type === 'Feature' ? geom_geojson.geometry : geom_geojson
    function extract(c) {
      if (typeof c[0] === 'number') { coords.push(c); return }
      c.forEach(extract)
    }
    extract(geom.coordinates)
    if (!coords.length) return null
    const lngs = coords.map(c => c[0])
    const lats = coords.map(c => c[1])
    return [Math.min(...lngs), Math.min(...lats), Math.max(...lngs), Math.max(...lats)]
  } catch {
    return null
  }
}
