<!-- dialecte-skills workspace -->

# Measuring dialecte performance

Measure a fresh build: after a source edit, rebuild (and refresh any consumer's copy of the build)
before measuring, or you measure old code.

## The perf helper (inside dialecte)

- Enable with `dev: { perf: true }` on project creation (the consumer passes it; dialecte never
  reads its own env).
- Marks and measures go on the standard performance timeline as `dialecte::<layer>::<name>`
  (`core::import::sax`, `core::store::bulkWrite`, `<dialecte>::<operation>`, ...).
- In node/vitest use `perf.report()` - per name `{ calls, totalMs, avgMs }`. Reset with
  `perf.reset()` once per scenario (e.g. `beforeEach`), not inside a transaction.
- Wrap new heavy paths with the helper. Never leave ad-hoc globals or `console.time` in source.

## Node bench harness (large synthetic documents, no browser)

- core: `src/test/fixtures/` has a stress-fixture generator (5 MB to 500 MB, gitignored) and a
  benchmark runner that imports the BUILT dist. Run `npm run build` first.
- A dialecte package may ship the same pair for its schema: see its skill.
- The runner reports per-method rows, setup timings, and the perf-helper breakdown. A coverage
  guard fails when a public method has no bench row: a new method needs a row. Super-linear
  counter growth means a round-trip-bound (O(n²)) path.
- Each fixture has a wall-time ceiling so a regression fails fast instead of hanging.

## In the browser

- Wall time: read `performance.getEntriesByType('measure')` filtered on `dialecte::` (through
  Playwright `page.evaluate`, in the right frame).
- CPU self-time: the CDP `Profiler` domain (`Profiler.start` / `Profiler.stop`), ranked by
  self-time. `console.profile()` is not readable by an agent.
- IndexedDB `count` iterates; it is not a cheap index lookup on large tables.

## Reading results

Explain a delta before acting on it. Compare against the previous commit on the same machine,
same fixture, several runs; a timed bench runs alone, its load recorded beside the numbers: beside another
suite its timings mean nothing (tests, unlike benches, run at full parallelism whatever the load).
