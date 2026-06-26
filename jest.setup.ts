import '@testing-library/jest-dom'

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
