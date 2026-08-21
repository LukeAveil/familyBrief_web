/**
 * apply-migrations.ts — dumb, idempotent SQL runner.
 * ────────────────────────────────────────────────────────────────────────────
 * Reads every *.sql file in ./migrations in lexical order and executes each
 * against SUPABASE_DB_URL using a one-shot pg.Client. That's it.
 *
 * WHY NO TRACKING TABLE (à la _migrations, drizzle-kit, node-pg-migrate):
 *   Every migration file is written with IF NOT EXISTS on the DDL, so re-running
 *   is a no-op. That lets us skip an entire schema-management framework in
 *   Stage 1 for a whole-file cost of ~40 lines. When we outgrow this — first
 *   time we need to ALTER a column, drop something, or backfill data — we'll
 *   introduce a real tool and this script goes away. Deliberately small.
 *
 * WHY A DEDICATED pg.Client (not the runtime Pool from lib/db.ts):
 *   This script runs once from a developer's laptop or CI, then exits. A Pool
 *   would open persistent connections we'd have to explicitly close; a Client
 *   is one connection, opened and closed inline. Simpler for one-shot work.
 *
 * WHY LOAD .env.local MANUALLY:
 *   Next.js autoloads .env.local for `next dev`/`next build`, but a plain
 *   `tsx` script does not. We read it once at the top so `npm run db:migrate`
 *   just works with the same env file the app uses.
 */

import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { Client } from 'pg'

// ─── Minimal .env.local loader ────────────────────────────────────────────────
// Not using dotenv to avoid adding a runtime dep just for this script. This
// covers the shapes we actually use: KEY=value, KEY="value with spaces",
// KEY='value', # comments, blank lines. Any KEY already set in process.env
// (e.g. exported in the shell, or set by CI) wins over the file — matches how
// dotenv and next behave.
function loadDotEnvLocal(): void {
  const envPath = resolve(process.cwd(), '.env.local')
  if (!existsSync(envPath)) return
  const raw = readFileSync(envPath, 'utf8')
  for (const line of raw.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq === -1) continue
    const key = trimmed.slice(0, eq).trim()
    let value = trimmed.slice(eq + 1).trim()
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    if (!(key in process.env)) process.env[key] = value
  }
}

async function main(): Promise<void> {
  loadDotEnvLocal()

  const url = process.env.SUPABASE_DB_URL
  if (!url) {
    console.error('SUPABASE_DB_URL is not set. Add it to .env.local and try again.')
    process.exit(1)
  }

  const migrationsDir = resolve(process.cwd(), 'migrations')
  const files = readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort() // lexical order: 001_..., 002_..., etc.

  if (files.length === 0) {
    console.log('No .sql files found in ./migrations — nothing to do.')
    return
  }

  // Single connection for the whole run; each file gets its own query() call.
  // We don't wrap the batch in a transaction because CREATE TABLE ... IF NOT
  // EXISTS is inherently idempotent per-statement, and keeping each file
  // independent means one bad file doesn't rollback earlier successful ones.
  const client = new Client({ connectionString: url })
  await client.connect()

  try {
    for (const file of files) {
      const sql = readFileSync(join(migrationsDir, file), 'utf8')
      process.stdout.write(`▸ ${file} ... `)
      await client.query(sql)
      process.stdout.write('ok\n')
    }
    console.log(`\nApplied ${files.length} migration(s).`)
  } finally {
    await client.end()
  }
}

main().catch((err: unknown) => {
  console.error('\nMigration failed:')
  console.error(err)
  process.exit(1)
})
