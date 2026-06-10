---
description: IO lifecycle hooks for @dialecte/core — beforeImport (whole-XML normalizer), beforeImportRecord (per-record SAX pass), and afterImport (post-store resolution). Fires during project.import, outside the transaction system.
---

# IO Hooks

Registered under `dialecteConfig.io.hooks`. Fires during `project.import` — not during transactions.

::: warning No store access
IO hooks run outside the transaction store. Do not call `getRecord` or any store API inside IO hooks. Accumulate state in closure variables during `beforeImportRecord`, then flush in `afterImport`.
:::

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

## `IO_HOOKS` pattern

Dialecte packages expose their hooks as a named `IO_HOOKS` constant conforming to `IOHooks`. This keeps the config file clean and the hooks independently testable.

```ts
// hooks/io/io-hooks.ts
import type { IOHooks } from '@dialecte/core'

export const IO_HOOKS: IOHooks = {
	beforeImport: (xml) => normalize(xml),
}

// config/dialecte.config.ts
import { IO_HOOKS } from '../hooks'

export const MY_DIALECTE_CONFIG = {
	io: { hooks: IO_HOOKS, supportedFileExtensions: ['.xml'] },
	// ...
} satisfies AnyDialecteConfig
```

---

## `beforeImportRecord`

Fires **per record**, in document order, synchronously during the SAX pass. Use it to index elements by attribute value for later resolution.

```ts
beforeImportRecord?: (params: {
  record: AnyRawRecord
  ancestry: readonly AnyRawRecord[]
}) => void
```

`ancestry` is top-down: `[root, ..., parent]`. No return value — use closure state.

**Example**

```ts
const indexByName = new Map<string, string>() // name → record id

const config = {
	io: {
		hooks: {
			beforeImportRecord: ({ record }) => {
				const name = record.attributes.find((a) => a.name === 'name')?.value
				if (name) indexByName.set(name, record.id)
			},
			afterImport: async () => {
				// resolve pending references using indexByName
				return { updates: [] }
			},
		},
	},
}
```

---

## `afterImport`

Fires **once** after all records are stored. Return batched creates, updates, and deletes — applied atomically by core in order: creates → updates → deletes.

```ts
afterImport?: () => Promise<AfterImportResult>
```

```ts
type AfterImportResult = {
	creates?: AnyRawRecord[]
	updates?: RecordPatch[] // { recordId, ...partial record }[]
	deletes?: string[] // record IDs
	warnings?: ImportWarning[]
}

type ImportWarning = {
	type: string // discriminant owned by the dialecte
	recordId: string
	details?: Record<string, unknown>
}
```

Use `warnings` to surface unresolved references, unknown paths, or any other dialecte-specific anomalies detected during the import pass.

---

## Firing order

```
beforeImport           (once - whole XML string)
[SAX parse begins]
beforeImportRecord     (per record, document order)
[records stored to IndexedDB]
afterImport            (once)
```

See [IO overview](/io/) for how this fits into the full import → API → export pipeline.
