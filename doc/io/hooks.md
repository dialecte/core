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
	beforeImportRecord?: (params: { record: AnyRawRecord; ancestry: readonly AnyRawRecord[] }) => void
	afterImport?: () => Promise<AfterImportResult<GenericDiagnostic>>
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

Fires **once** after all records are stored. Return batched creates, updates, and deletes — applied atomically by core in order: creates → updates → deletes — and the diagnostics of the file. The writes are applied whether or not there are diagnostics, and the diagnostics come back to the caller of the import with the document (`parseXmlFile` and `importDocument` return `diagnostics: Diagnostic[]`, `[]` when there is nothing to say).

```ts
afterImport?: () => Promise<AfterImportResult>
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

A `Diagnostic` is what the import has to say about one record — an unresolved reference, a value it rewrote — in the shape of the language-server protocol, on records instead of text ranges. Plain data: it crosses a worker boundary as is.

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

A dialecte declares its codes once, in a catalogue - `source`, and per code the severity, the family (`'value' | 'attribute' | 'structure' | 'identity' | 'reference' | 'import'`, a property of the entry, not of the diagnostic) and the default wording - and builds each diagnostic from it with `createDiagnostic`, which fills `severity`, `source` and `message` from the entry and keeps the type of the `meta` and `related` given:

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
afterImport             (once - writes applied, diagnostics returned)
```

See [IO overview](/io/) for how this fits into the full import → API → export pipeline.
