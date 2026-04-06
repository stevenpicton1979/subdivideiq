/**
 * checkout.js — Create Stripe Checkout session for SubdivideIQ report
 *
 * POST /api/checkout
 * Body: { address, email }
 *
 * Returns: { url } — redirect the user to this Stripe-hosted checkout page
 *
 * Flow:
 *   1. Frontend POSTs address + email
 *   2. This handler creates a Stripe Checkout Session ($79 AUD)
 *   3. Returns the Stripe-hosted checkout URL
 *   4. Frontend redirects user to Stripe
 *   5. On payment: Stripe webhook fires to /api/webhook
 *
 * Metadata stored in Stripe session (available in webhook):
 *   address, email, lat (optional), lng (optional)
 */

const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY)

const BASE_URL = process.env.BASE_URL || 'https://subdivideiq.vercel.app'

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', (process.env.ALLOWED_ORIGIN || '*').trim())
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const { address, email, lat, lng } = req.body || {}

  if (!address) return res.status(400).json({ error: 'address is required' })
  if (!email)   return res.status(400).json({ error: 'email is required' })

  if (!process.env.STRIPE_SECRET_KEY) {
    return res.status(500).json({ error: 'Stripe not configured' })
  }

  try {
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      payment_method_types: ['card'],
      customer_email: email,
      line_items: [
        {
          price_data: {
            currency: 'aud',
            unit_amount: 7900, // $79.00 AUD in cents
            product_data: {
              name: 'SubdivideIQ Feasibility Report',
              description: `Subdivision feasibility pre-screen: ${address}`,
              images: [] // Add SubdivideIQ logo URL when available
            }
          },
          quantity: 1
        }
      ],
      success_url: `${BASE_URL}/confirmation.html?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url:  `${BASE_URL}/`,
      metadata: {
        product: 'subdivideiq',
        address,
        email,
        lat:  lat  ? String(lat)  : '',
        lng:  lng  ? String(lng)  : ''
      }
    })

    return res.json({ url: session.url, session_id: session.id })
  } catch (err) {
    console.error('[checkout] Stripe error:', err.message)
    return res.status(500).json({ error: err.message || 'Checkout creation failed' })
  }
}
