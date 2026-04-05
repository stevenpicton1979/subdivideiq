module.exports = (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Content-Type', 'application/json')
  res.json({ mapboxToken: (process.env.MAPBOX_TOKEN || '').trim() })
}
