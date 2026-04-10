---
description: IO lifecycle hooks for @dialecte/core — beforeImportRecord (per-record SAX pass) and afterImport (post-store resolution). Fires during importXmlFiles, outside the transaction system.
---

# IO Hooks

Registered under `dialecteConfig.io.hooks`. Fires during `importXmlFiles` — not during transactions.

::: warning No store access
IO hooks run outside the transaction store. Do not call `getRecord` or any store API inside IO hooks. Accumulate state in closure variables during `beforeImportRecord`, then flush in `afterImport`.
:::

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
beforeImportRecord     (per record, document order)
[records stored to IndexedDB]
afterImport            (once)
```

See [IO overview](/io/) for how this fits into the full import → API → export pipeline.
