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

| Method              | Purpose                                                                                 |
| ------------------- | --------------------------------------------------------------------------------------- |
| `start(name)`       | Open a span (name-keyed, like `console.time`)                                           |
| `stop(name)`        | Close the most recent open span for `name` (unmatched `stop` no-op)                     |
| `count(name)`       | Tally an event (round-trips, cache hits/misses) — no timing, surfaced as `count`        |
| `profile(name, fn)` | Run `fn` inside a DevTools CPU profile (no-op in node/headless)                         |
| `report()`          | Aggregate the timeline **synchronously** — `{ calls, totalMs, avgMs, count? }` per name |
| `log()`             | `console.table(report())`                                                               |
| `reset()`           | Clear all marks + measures + counters (bound memory between scenarios)                  |

`report()` reads the timeline fresh on demand — there is no `PerformanceObserver`,
so `stop(); report()` in the same tick already sees the result. A counted-only name
(no span) appears with zeroed timing and its `count`.

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
