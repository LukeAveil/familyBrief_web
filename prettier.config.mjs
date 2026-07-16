// Prettier configuration.
//
// This is a .mjs (not .prettierrc.json) on purpose: JSON can't carry comments,
// and the whole point of this harness is that every choice is explained.
//
// The values below are deliberately chosen to MATCH the code style already in
// this repo (single quotes, no semicolons, trailing commas, ~100 columns). That
// matters: when Prettier's defaults disagree with existing code, the first
// `prettier --write` becomes a huge, noisy diff that buries real changes and
// makes people distrust the formatter. Matching the existing style keeps the
// initial reformat close to a no-op, so from here on Prettier just holds the
// line rather than rewriting history.
//
// @type {import("prettier").Config}
const config = {
  // The repo already omits semicolons; Prettier's default is `true`, which would
  // have added one to nearly every line. Match reality instead.
  semi: false,

  // Existing code uses single quotes throughout. Default is double.
  singleQuote: true,

  // Trailing commas on multiline literals/params. Keeps diffs minimal (adding a
  // line doesn't also touch the previous line's comma) and matches existing code.
  // 'all' is the modern default in Prettier 3, and this codebase already relies
  // on it (see the multiline object/param lists in lib/extract-events.ts).
  trailingComma: 'all',

  // The codebase has several ~90-100 char lines (e.g. the cal-string builders).
  // Prettier's default of 80 would aggressively rewrap them. 100 is a common
  // pragmatic width that keeps those lines intact.
  printWidth: 100,
}

export default config
