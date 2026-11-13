# Dev Perf (User Timing)

`createPerf` is a dev-only metrics helper built on the platform User Timing API
(`performance.mark` / `performance.measure`). Spans live on the standard
`performance` timeline, so they show up on the DevTools Performance panel and are
readable programmatically via `performance.getEntriesByType('measure')` — no
custom global, no console scraping.

## Enabling

Perf is off by default. Turn it on per project with the `dev.perf` flag:

```ts
const project = new Project({
	configs: { default: config },
	storage: { type: 'local' },
	dev: { perf: true }, // usually import.meta.env.DEV from the consuming app
})
```

Every document and transaction opened from that project shares one perf instance:

- `doc.perf` — on the document
- `tx.perf` — inside a transaction callback
- `ctx.perf` — inside a core/query op (via `Context`)

When `dev.perf` is off, `perf` is a frozen no-op: nothing is written and
`report()` returns `{}`. It tree-shakes to zero prod cost.

## Naming convention

Callers pass `<layer>::<name>`; `createPerf` prepends a fixed `dialecte::` root.
`report()` filters the shared timeline by that root and strips it back off, so
measures from other libraries never pollute the report.

```ts
perf.start('demo::bulkInsert')
perf.stop('demo::bulkInsert')
```

## API

| Method                      | Purpose                                                                                         |
| --------------------------- | ----------------------------------------------------------------------------------------------- |
| `start(name)`               | Open a span (name-keyed, like `console.time`)                                                   |
| `stop(name)`                | Close the most recent open span for `name` (unmatched `stop` no-op)                             |
| `count(name)`               | Tally an event (round-trips, cache hits/misses) — no timing, surfaced as `count`                |
| `profile(name, fn)`         | Run `fn` inside a DevTools CPU profile (no-op in node/headless)                                 |
| `report()`                  | Aggregate the timeline **synchronously** — `{ calls, totalMs, avgMs, count? }` per name         |
| `log()`                     | `console.table(report())`                                                                       |
| `reset()`                   | Clear all marks + measures + counters (bound memory between scenarios)                          |
| `snapshot()`                | This perf's spans (on its realm's clock), its tallies and its `timeOrigin`, as data             |
| `merge({ report, prefix })` | Fold another realm's `snapshot()` in under `<prefix>::<name>`, spans shifted onto this timeline |

`report()` reads the timeline fresh on demand — there is no `PerformanceObserver`,
so `stop(); report()` in the same tick already sees the result. A counted-only name
(no span) appears with zeroed timing and its `count`.

`createPerf({ enabled, timeline: false })` keeps its spans in the perf only (`report()` and
`snapshot()` read them): the perf of a realm whose spans another realm merges.

## Import stages

The store runs each import with a perf of its own and hands its `snapshot()` back; the project
merges it under `store::` - whichever store ran it: in the page, in a worker or on a server - its
spans placed on the page's timeline (shifted by the difference of the two realms' `timeOrigin`). With `dev.perf` on, `project.perf.report()` holds:

| Name                          | Kind  | What                                                                                                             |
| ----------------------------- | ----- | ---------------------------------------------------------------------------------------------------------------- |
| `store::import`               | span  | the whole import, register to ready                                                                              |
| `store::import::register`     | span  | the document registered `importing`                                                                              |
| `store::import::decode`       | tally | bytes decoded to text, per chunk                                                                                 |
| `store::import::parse`        | tally | the SAX pass, per chunk (holds the two per-record tallies)                                                       |
| `store::import::standardize`  | tally | per record                                                                                                       |
| `store::import::hooks.record` | tally | the session's `beforeImportRecord`, per record handed                                                            |
| `store::import::insert`       | span  | one stored batch                                                                                                 |
| `store::import::hooks.after`  | span  | the session's `afterImport`                                                                                      |
| `store::import::writes.after` | span  | the writes `afterImport` returned                                                                                |
| `store::import::finalize`     | span  | the document set `ready`                                                                                         |
| `store::import::phase.<name>` | span  | each phase the import tells (`storing`, `processing`, `checking`, `applying`, `finishing`); `indexing` on SQLite |
| `store::import::hook.<step>`  | span  | each step the session's `afterImport` reports                                                                    |

On `sqlite` storage the import runs in the engine's worker, on the engine's clock, and its report holds three more names:

| Name                    | Kind  | What                                                                                      |
| ----------------------- | ----- | ----------------------------------------------------------------------------------------- |
| `store::import::encode` | tally | records checked as JSON and encoded for SQLite, per batch                                 |
| `store::import::commit` | tally | one import transaction committed (the import commits in time-capped transactions)         |
| `store::import::index`  | span  | one index built on the document's table (the edits of other views wait while it is built) |

## Export stages

Each store export is measured the same way and merged under `store::` (a `Project.export` that makes two store exports
merges both):

| Name                      | Kind  | What                                                  |
| ------------------------- | ----- | ----------------------------------------------------- |
| `store::export`           | span  | the whole export, a restart included                  |
| `store::export::read`     | span  | one read of a parent's children (`batchSize` at most) |
| `store::export::write`    | tally | the XML written, per element opened or closed         |
| `store::export::assemble` | span  | the file put together from its parts                  |

## Example (core-agnostic)

```ts
// Time a bulk insert of N `Item`s under `Root`, then read the aggregate.
const project = new Project({
	configs: { default: config },
	storage: { type: 'local' },
	dev: { perf: true },
})
await project.open('demo')
const doc = project.openDocument(documentId)

await doc.transaction(async (tx) => {
	tx.perf.start('demo::bulkInsert')
	for (const item of items) await tx.addChild(root, item)
	tx.perf.stop('demo::bulkInsert')
})

doc.perf.report() // { 'demo::bulkInsert': { calls: 1, totalMs: 12.3, avgMs: 12.3 } }
doc.perf.reset() // clear before the next measured scenario
```

## Reading from an agent / browser

Because spans are standard `performance.measure` entries, an agent can read them
directly after driving an action:

```ts
performance
	.getEntriesByType('measure')
	.filter((e) => e.name.startsWith('dialecte::'))
	.map((e) => [e.name, e.duration])
```

For CPU self-time of a hot function, capture a sampling profile over CDP
(`Profiler.start` / `Profiler.stop`) rather than wrapping per-call loops in
`start`/`stop` — User Timing measures wall-time (including awaits), not CPU.
