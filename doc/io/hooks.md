---
description: IO lifecycle hooks for @dialecte/core — beforeImport (whole-XML normalizer) and createImportSession, the per-file session whose beforeImportRecord (per-record SAX pass) and afterImport (post-store resolution, diagnostics) fire during project.import, outside the transaction system.
---

# IO Hooks

Provided on the `Project` instance alongside the record hooks — one flat [`DialecteHooks`](/api/hooks) object passed to `new Project({ hooks })`, not on the config. Fires during `project.import` — not during transactions.

::: warning No store access
IO hooks run outside the transaction store. Do not call `getRecord` or any store API inside IO hooks. Accumulate state in the session during `beforeImportRecord`, then flush in `afterImport`.
:::

```ts
type IOHooks = {
	beforeImport?: (xml: string) => string
	createImportSession?: (params: { documentId: string; configKey: string }) => ImportSession
}

type ImportSession<GenericDiagnostic extends Diagnostic = Diagnostic> = {
	recordTagNames?: readonly string[] // the records beforeImportRecord is handed; absent = all
	beforeImportRecord?: (params: { record: AnyRawRecord; ancestry: readonly AnyRawRecord[] }) => void
	afterImport?: (context: AfterImportContext) => Promise<AfterImportResult<GenericDiagnostic>>
}
```

## `beforeImport`

Fires **once**, before the SAX parser starts. Use it to normalize a non-standard XML dialect into the canonical form expected by the dialecte config. Returns the transformed XML string.

```ts
beforeImport?: (xml: string) => string
```

The return value replaces the input for all subsequent IO steps (SAX parse, `beforeImportRecord`, `afterImport`).

**Example** - detect and normalize a legacy XML format:

```ts
import { inspectXml } from '@dialecte/core'

function isLegacyFormat(xml: string): boolean {
	const report = inspectXml(xml, { elements: ['legacyRoot'] as const })
	return report.legacyRoot !== undefined
}

function normalizeLegacy(xml: string): string {
	// transform to canonical form
	return xml.replace(...)
}

const hooks: IOHooks = {
	beforeImport: (xml) => (isLegacyFormat(xml) ? normalizeLegacy(xml) : xml),
}
```

---

## `createImportSession`

Fires **once per file**, after `beforeImport` and before the SAX parser starts, with the id the document was registered under and the key of its config. The `ImportSession` it returns holds the two per-file hooks and whatever state they share; core drops it after `afterImport`. Two files imported one after the other never see each other's state, and nothing has to be reset by hand.

```ts
createImportSession?: (params: { documentId: string; configKey: string }) => ImportSession
```

A dialecte writes the session as a factory and hands it to the `Project` with its record hooks:

```ts
// hooks/io/import-session.ts
import type { ImportSession } from '@dialecte/core'

export function createMyImportSession(): ImportSession {
	const indexByName = new Map<string, string>() // this file's only
	return {
		beforeImportRecord: ({ record }) => {
			/* accumulate into indexByName */
		},
		afterImport: async () => ({ updates: [], diagnostics: [] }),
	}
}

// factory that builds the Project
new Project({
	configs,
	storage,
	// io hooks + record hooks, one flat object
	hooks: { createImportSession: createMyImportSession, ...RECORD_HOOKS },
})
```

---

## `beforeImportRecord`

Fires **per record**, in document order, synchronously during the SAX pass. Use it to index elements by attribute value for later resolution.

The record is passed **after standardization** (canonical attribute order + defaults + `afterStandardizedRecord`), so any hook-enforced attribute — e.g. a generated `uuid` — is already present. Read it directly rather than re-deriving it.

```ts
beforeImportRecord?: (params: {
  record: AnyRawRecord
  ancestry: readonly AnyRawRecord[]
}) => void
```

`ancestry` is top-down: `[root, ..., parent]` (still-open parents, not yet standardized). No return value — keep what you need in the session.

A session that needs only some records names their tags: with `recordTagNames`, `beforeImportRecord` is handed the records of those tags only; the others pass it by and no ancestry is handed for them. Absent, every record is handed.

```ts
return {
	recordTagNames: ['LNode', 'FunctionRef'],
	beforeImportRecord: ({ record, ancestry }) => {
		/* only LNode and FunctionRef records */
	},
}
```

Hooks run wherever the store imports - a worker, later a server next to the data - so a session never reads the store: it keeps what it needs from the records it is handed.

**Example**

```ts
function createImportSession(): ImportSession {
	const indexByName = new Map<string, string>() // name → record id
	return {
		beforeImportRecord: ({ record }) => {
			const name = record.attributes.find((a) => a.name === 'name')?.value
			if (name) indexByName.set(name, record.id)
		},
		afterImport: async () => {
			// resolve pending references using indexByName
			return { updates: [] }
		},
	}
}
```

---

## `afterImport`

Fires **once** after all records are stored. Return batched creates, updates, and deletes — applied atomically by core in order: creates → updates → deletes — and the diagnostics of the file. The writes are applied whether or not there are diagnostics, and the diagnostics come back to the caller of the import with the document (`parseXmlFile`, `runImport` and every store's `importFile` return `diagnostics: Diagnostic[]`, `[]` when there is nothing to say). A hook that throws fails the import and removes the document: a structured error as thrown, anything else as `IMPORT_FAILED` with the thrown value as its `cause`.

The hook must settle. Nothing aborts a hook that never resolves: its import stays in flight, the project engine stays busy with it, and `project.close()` and `destroy()` wait for it for good - after 10 seconds the console names the files the close still waits for. A hook waiting on something outside the import (a network call, a user's answer) bounds that wait itself and throws when it gives up.

```ts
afterImport?: (context: AfterImportContext) => Promise<AfterImportResult>

type AfterImportContext = {
	report: (step: { step: string; done?: number; total?: number }) => void
	signal: AbortSignal
}
```

The context is optional to read: a hook that takes no argument works as before. Code that calls a session's `afterImport` itself - a test, a session wrapping another - passes it a context: `afterImport({ report, signal })`.

- `report({ step, done, total })` tells the import's caller where the hook is: its progress says `phase: 'processing'` with the step (core tells `step: 'start'` once before the hook runs). Name each step of the hook and give `done` / `total` when the step loops over a count it holds. Core keeps at most one report per `IMPORT_PROGRESS_INTERVAL_MS` (50 ms) per file and always tells the last of a step, so a long loop may report every item. `report` never throws and is ignored once the import is aborted. With dev perf on, each step is a span `import::hook.<step>`.
- `signal` is the import's abort. Check it between steps (and every so many items in a long loop) and stop - return or throw, it does not matter: core throws `IMPORT_ABORTED` and keeps nothing of the file, whatever the hook did.

```ts
afterImport: async ({ report, signal }) => {
	for (const [done, target] of targets.entries()) {
		if (signal.aborted) return {}
		resolve(target)
		report({ step: 'references', done: done + 1, total: targets.length })
	}
	report({ step: 'names' })
	return { updates }
}
```

```ts
type AfterImportResult<GenericDiagnostic extends Diagnostic = Diagnostic> = {
	creates?: AnyRawRecord[]
	updates?: RecordPatch[] // { recordId, ...partial record, removeAttributes? }[]
	deletes?: string[] // record IDs
	diagnostics?: GenericDiagnostic[]
}
```

A `RecordPatch` merges `attributes` by name: an existing attribute is overwritten, a new one is appended. To drop attributes, list their names in `removeAttributes`. Removal is applied after the merge, so an attribute that the same patch sets and removes ends up removed.

```ts
afterImport: async () => ({
	updates: [
		{ recordId: 'a-1', attributes: [{ name: 'label', value: 'A' }], removeAttributes: ['legacy'] },
	],
})
```

### Diagnostics

A `Diagnostic` is what the import has to say about one record — an unresolved reference, a value it rewrote — in the shape of the language-server protocol, on records instead of text ranges. Plain data: it crosses a worker boundary as is. A session's diagnostics are checked as a store checks what a write hands it: one that is not plain JSON (a function in its `meta`) or holds text that is not well-formed (a lone surrogate) fails the import with `STORE_VALUE_NOT_JSON`, nothing of the file kept.

```ts
type Diagnostic<GenericCode extends string = string> = {
	code: GenericCode // a code of the producer's catalogue
	severity: 'error' | 'warning' | 'information' | 'hint'
	source: string // who said it: the dialecte's name
	message: string // default wording; a consumer words it from code + meta
	ref: { tagName: string; id: string; attribute?: string }
	related?: { ref: DiagnosticRef; message: string }[] // the other records it involves
	meta?: Record<string, unknown> // what it is about, as data
}
```

A dialecte declares its codes once, in a catalogue - `source`, and per code the severity, the family (`'value' | 'attribute' | 'structure' | 'identity' | 'reference' | 'import'`, a property of the entry, not of the diagnostic) and the default wording, optionally an `explanation` (`when` it is raised, the usual `fix`, a `docs` page) - and builds each diagnostic from it with `createDiagnostic`, which fills `severity`, `source` and `message` from the entry and keeps the type of the `meta` and `related` given:

```ts
import { createDiagnostic } from '@dialecte/core'

import type { DiagnosticCatalogue } from '@dialecte/core'

export const MY_IMPORT_DIAGNOSTICS = {
	source: 'my-dialecte',
	codes: {
		'unresolved-reference': {
			severity: 'warning',
			family: 'reference',
			message: 'A reference names an element the file does not hold',
			// optional: what `dialecte explain unresolved-reference` prints
			explanation: {
				when: 'The path a reference holds names no element of the file',
				fix: 'Import the file that holds the element, or correct the path',
			},
		},
	},
} as const satisfies DiagnosticCatalogue

createDiagnostic(MY_IMPORT_DIAGNOSTICS, 'unresolved-reference', {
	ref: { tagName: 'FunctionRef', id: record.id, attribute: 'function' },
	meta: { pathValue, triedKeys },
})
```

A consumer that holds a `Diagnostic[]` of unknown origin narrows it to the codes it knows with `isKnownDiagnostic(diagnostic, { catalogues: [MY_IMPORT_DIAGNOSTICS] })` - matched on the pair `source` + `code`, so two dialectes may share a code.

---

## Firing order

```
beforeImport            (once - whole XML string)
createImportSession     (once - { documentId, configKey })
[SAX parse begins]
afterStandardizedRecord (per record - standardization runs first)
beforeImportRecord      (per record, document order - receives the standardized record)
[records stored]
afterImport             (once - { report, signal }; its steps reported, writes checked then applied, diagnostics returned)
```

See [IO overview](/io/) for how this fits into the full import → API → export pipeline.
