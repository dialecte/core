<!-- dialecte-skills workspace -->

# Verification traps in dialecte repos

Each of these produced a confident, wrong "green". Before reporting a gate as passed, check that it
ran what you think it ran.

## Type checking

- `tsc -p tsconfig.json --noEmit` checks **nothing**: `tsconfig.json` is a solution file
  (`files: []` + references). Use `npm run check`, which runs `tsconfig.build.json` (sources) and
  `tsconfig.vitest.json` (tests).
- The build config excludes `*.test.ts`: a type error in a test passes `npm run build`. Only
  `npm run check` (or `tsc -p tsconfig.vitest.json --noEmit`) sees it.
- `npm run build` runs the type-check in parallel and emits declarations through vite-plugin-dts,
  which catches union-assignability errors the editor misses (its own `tsc -p tsconfig.json` step
  is the solution no-op). Run it; editor squiggles are not a gate.
- `ReturnType<typeof genericFactory>` instantiates type parameters with their constraint, not the
  default: an extension map widens to an index signature. Type from a call (`const p = factory()`).

## Tests

- vitest pre-bundles dependencies into `node_modules/.vite`. After changing what a package
  resolves for `@dialecte/core` (link, copied `dist/`), delete `node_modules/.vite` and
  `node_modules/.vite-temp`, or tests keep running the old core while `tsc` sees the new one.
- Shell wrappers that compact output can report `PASS (0) FAIL (0)` or "ok" for a run that failed
  or ran nothing. Run verdict-bearing commands unfiltered and read the real counts.
- A case that is green on its first run may be green by accident (an XPath matching another
  element, last-wins index, id order). Break the code on purpose once.
- Benches running in the browser print nothing unless run with `--silent=false`.

## Tooling

- Never run `pnpm` in an npm repo: it rewrites `node_modules` to the pnpm layout, replaces linked
  packages with published ones and creates a pnpm lockfile. Repair, only in the repo you broke and
  after checking no hand-over script is running there: delete the pnpm files,
  `rm -rf node_modules && npm ci`, redo any deliberate local link, clear `.vite`.
- Never run `prettier` in these repos: format with `oxfmt` (`npx oxfmt <paths>`,
  `npm run format:check`).
- A package's `npm run doc:build` may regenerate a committed data file (an element catalog, a
  generated docs page). If you did not mean to change it, restore it right after the doc build,
  before `check` and before any hand-over script exists - never while one is waiting. The
  package's own skill names such files.
- Before `@dialecte/cli` 0.2.0, `dialecte bench --help` is not a help flag: it runs the bench and
  writes `baseline.json`. From 0.2.0, `--help` on any command only prints the help.
- Type bench counts are only order-stable single-threaded (TypeScript 7 runs parallel checkers that
  each re-create types). Bench through the package's single-checker bench tsconfig.
- `dialecte-xmlfmt` reformats `/* xml */` template literals; it can mangle a nested template
  literal - check the diff.

## Shell

- zsh does not word-split `$FILES`: `git diff -- $FILES` with a space-separated list addresses one
  non-existent path and hashes an empty diff. Use an array inside `bash`, and print `--stat` next to
  every hash or verdict so an empty one is visible.
- macOS ships bash 3.2: no `mapfile`, no associative arrays. Scripts handed to a human should
  re-exec themselves in bash and stay 3.2-compatible.
- Never `open(path, 'w')` and read the same file in one expression (truncation loses work).

## Docs and code drift you will meet

Docs can lag the code. When they disagree, the source wins, and fixing the doc is part of the
change if you touch that surface. Known kinds of drift: methods named in docs that no longer exist,
docs still showing an older project/hooks wiring, JSDoc describing an older lookup order, stale
npm scripts pointing at missing files, dead links in AGENTS.md.
