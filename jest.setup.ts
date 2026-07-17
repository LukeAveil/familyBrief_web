import '@testing-library/jest-dom'
import { TextEncoder, TextDecoder } from 'util'

// jsdom omits the Web text encoders that streaming code (the SSE readers in
// ScreenRouter/ChatPanel) relies on. Provide them once for every test via
// Object.assign, which widens `global` without an `as any` cast.
Object.assign(global, { TextEncoder, TextDecoder })

// Provide a dummy key so modules that validate ANTHROPIC_API_KEY at import/call
// time don't throw in the test environment. The Anthropic SDK itself is mocked.
process.env.ANTHROPIC_API_KEY = 'test'

if (typeof window !== 'undefined') {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: jest.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: jest.fn(),
      removeListener: jest.fn(),
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
      dispatchEvent: jest.fn(),
    })),
  })
}
