/**
 * @jest-environment node
 */

// Mock pg so we never actually open a TCP connection. We only care about the
// singleton/env-var contract of getPool() — not what pg.Pool does internally.
const mockPoolCtor = jest.fn()

jest.mock('pg', () => ({
  __esModule: true,
  Pool: jest.fn().mockImplementation((...args: unknown[]) => {
    mockPoolCtor(...args)
    // Return a distinct object each time so identity comparisons are meaningful.
    return { __marker: Math.random() }
  }),
}))

import { getPool, __resetPoolForTests } from '@/lib/db'

const ORIGINAL_ENV = { ...process.env }

beforeEach(() => {
  mockPoolCtor.mockClear()
  __resetPoolForTests()
  process.env = { ...ORIGINAL_ENV }
})

afterAll(() => {
  process.env = ORIGINAL_ENV
})

describe('lib/db.getPool', () => {
  it('throws when SUPABASE_DB_URL is missing', () => {
    delete process.env.SUPABASE_DB_URL
    expect(() => getPool()).toThrow('SUPABASE_DB_URL environment variable is not set')
    expect(mockPoolCtor).not.toHaveBeenCalled()
  })

  it('constructs a Pool with the connection string on first call', () => {
    process.env.SUPABASE_DB_URL = 'postgres://user:pass@host:5432/db'
    const pool = getPool()
    expect(pool).toBeDefined()
    expect(mockPoolCtor).toHaveBeenCalledTimes(1)
    expect(mockPoolCtor).toHaveBeenCalledWith({
      connectionString: 'postgres://user:pass@host:5432/db',
    })
  })

  it('returns the same pool on repeated calls (singleton)', () => {
    process.env.SUPABASE_DB_URL = 'postgres://user:pass@host:5432/db'
    const a = getPool()
    const b = getPool()
    const c = getPool()
    expect(a).toBe(b)
    expect(b).toBe(c)
    expect(mockPoolCtor).toHaveBeenCalledTimes(1)
  })

  it('creates a fresh pool after __resetPoolForTests', () => {
    process.env.SUPABASE_DB_URL = 'postgres://user:pass@host:5432/db'
    const a = getPool()
    __resetPoolForTests()
    const b = getPool()
    expect(a).not.toBe(b)
    expect(mockPoolCtor).toHaveBeenCalledTimes(2)
  })
})
