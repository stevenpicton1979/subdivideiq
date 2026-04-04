/**
 * db.js — Shared Supabase/Postgres connection factory
 * Each call returns a fresh connected Client. Caller must call client.end() in finally.
 */

const { Client } = require('pg')

const DATABASE_URL = process.env.DATABASE_URL

function getClient() {
  if (!DATABASE_URL) throw new Error('DATABASE_URL not set')
  return new Client({
    connectionString: DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  })
}

module.exports = { getClient }
