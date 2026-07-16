import { defineConfig, globalIgnores } from 'eslint/config'
import nextVitals from 'eslint-config-next/core-web-vitals'
import nextTs from 'eslint-config-next/typescript'
// Turns OFF any ESLint rules that would report on formatting (quotes, semicolons,
// spacing, etc.). Prettier owns formatting now; without this, ESLint and Prettier
// can disagree on the same line and fight in an unwinnable loop. It must come
// LAST in the array so its "disable" wins over anything the Next presets enable.
// `eslint-config-prettier/flat` is the flat-config (ESLint 9) entry point.
import prettier from 'eslint-config-prettier/flat'

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    '.next/**',
    'out/**',
    'build/**',
    'next-env.d.ts',
  ]),
  prettier,
])

export default eslintConfig
