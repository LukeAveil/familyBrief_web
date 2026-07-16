import type { Config } from 'jest'
import nextJest from 'next/jest.js'

const createJestConfig = nextJest({ dir: './' })

const config: Config = {
  coverageProvider: 'v8',
  testEnvironment: 'jsdom',
  setupFilesAfterEnv: ['<rootDir>/jest.setup.ts'],
  // Jest's default testMatch treats EVERY file under __tests__/ as a test suite.
  // Our fixtures folder holds shared sample data (school messages + expected
  // output), not tests — running it as a suite fails ("no tests" + it imports the
  // real SDK). Ignore the folder so fixtures can live alongside the tests that use
  // them. The default '/node_modules/' entry must be kept when overriding.
  testPathIgnorePatterns: ['/node_modules/', '<rootDir>/__tests__/fixtures/'],
}

export default createJestConfig(config)
