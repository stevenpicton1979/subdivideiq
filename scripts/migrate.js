/**
 * migrate.js — Create SubdivideIQ tables in Supabase fzykfxesznyiigoyeyed
 * Run: node scripts/migrate.js
 * Note: Uses $func$ not $$ for SQL function bodies (Supabase requirement)
 */

require('dotenv').config()
const { Client } = require('pg')

const DATABASE_URL = process.env.DATABASE_URL

if (!DATABASE_URL) {
  console.error('DATABASE_URL not set in .env')
  process.exit(1)
}

const migrations = [
  {
    name: 'create subdivide_parcels',
    sql: `
      CREATE TABLE IF NOT EXISTS subdivide_parcels (
        id bigserial primary key,
        lot text,
        plan text,
        address text,
        area_m2 numeric,
        geom geometry(MultiPolygon, 4326)
      );
      CREATE INDEX IF NOT EXISTS subdivide_parcels_geom_idx ON subdivide_parcels USING GIST (geom);
    `
  },
  {
    name: 'create subdivide_sw_pipes',
    sql: `
      CREATE TABLE IF NOT EXISTS subdivide_sw_pipes (
        id bigserial primary key,
        pipe_id text,
        material text,
        diameter_mm numeric,
        geom geometry(LineString, 4326)
      );
      CREATE INDEX IF NOT EXISTS subdivide_sw_pipes_geom_idx ON subdivide_sw_pipes USING GIST (geom);
    `
  },
  {
    name: 'create subdivide_sw_drains',
    sql: `
      CREATE TABLE IF NOT EXISTS subdivide_sw_drains (
        id bigserial primary key,
        drain_id text,
        drain_type text,
        geom geometry(MultiLineString, 4326)
      );
      CREATE INDEX IF NOT EXISTS subdivide_sw_drains_geom_idx ON subdivide_sw_drains USING GIST (geom);
    `
  },
  {
    name: 'create subdivide_reports',
    sql: `
      CREATE TABLE IF NOT EXISTS subdivide_reports (
        id bigserial primary key,
        address text,
        lot text,
        plan text,
        result text,
        flags jsonb,
        stripe_session_id text,
        email text,
        created_at timestamptz default now()
      );
    `
  }
]

async function migrate() {
  const client = new Client({
    connectionString: DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  })

  try {
    await client.connect()
    console.log('Connected to Supabase fzykfxesznyiigoyeyed')

    for (const m of migrations) {
      console.log(`Running: ${m.name}...`)
      await client.query(m.sql)
      console.log(`  ✅ ${m.name}`)
    }

    // Verify tables exist
    const res = await client.query(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name LIKE 'subdivide_%'
      ORDER BY table_name
    `)
    console.log('\nSubdivideIQ tables in Supabase:')
    res.rows.forEach(r => console.log(' ', r.table_name))

    console.log('\nMigration complete ✅')
  } catch (err) {
    console.error('Migration failed:', err.message)
    process.exit(1)
  } finally {
    await client.end()
  }
}

migrate()
