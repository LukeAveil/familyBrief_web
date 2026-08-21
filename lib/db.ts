/**
 * lib/db.ts — the single Postgres connection pool for the whole app.
 * ────────────────────────────────────────────────────────────────────────────
 * WHY A LAZY, MODULE-LEVEL POOL
 *   `pg.Pool` maintains N persistent TCP connections and hands them out per
 *   query. Creating one pool per request would exhaust Postgres connections
 *   within seconds; creating one per module import would fire at import time
 *   (before env vars are validated, and in test environments that don't need
 *   a DB at all). So: one pool for the process, built lazily the first time
 *   getPool() is called. Matches the pattern used for the Anthropic client in
 *   lib/extract-events.ts:41-52.
 *
 * WHY globalThis IN DEV
 *   Next.js dev-mode HMR reloads modules on file change. Without a globalThis
 *   guard, every hot reload would leak a whole new pool while the old one is
 *   still holding connections open. Attaching to globalThis makes the pool
 *   survive HMR. In production we don't do this — no HMR, and globalThis
 *   pollution is best avoided when it isn't earning its keep.
 *
 * WHY SESSION POOLER (port 5432 via Supavisor), NOT TRANSACTION POOLER (6543)
 *   node-postgres promotes parameterized queries to server-side PREPARED
 *   statements and caches them per connection. The transaction pooler
 *   aggressively swaps the underlying connection between queries, so the
 *   prepared statement `pg` thinks is cached is silently gone — subsequent
 *   executions error with `prepared statement "s1" does not exist`. The
 *   session pooler pins a client to a connection for the life of the session,
 *   which is what pg + @auth/pg-adapter need. Only switch to transaction mode
 *   if we also disable prepared-statement caching (non-trivial).
 */

import { Pool } from 'pg'

// The dev-mode global stash. Typed with a symbol'd property so we don't
// collide with anything else that puts stuff on globalThis.
const POOL_KEY = Symbol.for('familybrief.pgPool')
type GlobalWithPool = typeof globalThis & { [POOL_KEY]?: Pool }

let _pool: Pool | null = null

export function getPool(): Pool {
  if (_pool) return _pool

  // In dev, prefer whatever pool already exists across HMR reloads.
  const g = globalThis as GlobalWithPool
  if (process.env.NODE_ENV !== 'production' && g[POOL_KEY]) {
    _pool = g[POOL_KEY]!
    return _pool
  }

  const connectionString = process.env.SUPABASE_DB_URL
  if (!connectionString) {
    throw new Error('SUPABASE_DB_URL environment variable is not set')
  }

  _pool = new Pool({ connectionString })

  if (process.env.NODE_ENV !== 'production') {
    g[POOL_KEY] = _pool
  }
  return _pool
}

// Test-only: drop the cached pool so a fresh call to getPool() reads env vars
// again. Not exported to app code — only referenced from __tests__/lib/db.test.ts.
export function __resetPoolForTests(): void {
  _pool = null
  const g = globalThis as GlobalWithPool
  delete g[POOL_KEY]
}
