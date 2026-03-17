---
description: How to write and register domain-specific extensions for a dialecte. Extensions are plain functions bound onto the Query/Transaction instances via mergeExtensions(), making methods like doc.query.History.getSortedHitems() available with full type safety.
---

# Writing Extensions

Extensions add domain-specific methods as plain functions registered under a named group. Once wired into `openDialecteDocument`, they appear directly on `doc.query` and on the `tx` callback argument — fully typed against your element set.

## How it works

1. **Write functions** — plain async functions whose first argument is `Scl.Query` or `Scl.Transaction`
2. **Bundle into a module** — gather related functions into `{ query, transaction }` objects
3. **Register** — pass named modules to `mergeExtensions({ History, IED, ... })`
4. **Wire** — pass the result as `extensions` to `openDialecteDocument`

The `Document` binds them onto each `Query`/`Transaction` instance automatically. No subclassing needed.

## Writing extension functions

Each function takes the query (or transaction) as its first argument. The remaining arguments become its public signature after binding.

**Query extension** (`History/query/get-sorted-hitem.ts`):

```ts
import type { Scl } from '@/v2019C1/config'

export async function getSortedHitems(query: Scl.Query): Promise<Scl.TrackedRecord<'Hitem'>[]> {
	const history = (await query.getRecordsByTagName('History'))[0]
	if (!history) return []

	const { Hitem: hitems = [] } = await query.findDescendants(history)

	return [...hitems].sort((a, b) => {
		const vA = Number(a.attributes.find((attr) => attr.name === 'version')?.value ?? 0)
		const vB = Number(b.attributes.find((attr) => attr.name === 'version')?.value ?? 0)
		if (vA !== vB) return vA - vB
		const rA = Number(a.attributes.find((attr) => attr.name === 'revision')?.value ?? 0)
		const rB = Number(b.attributes.find((attr) => attr.name === 'revision')?.value ?? 0)
		return rA - rB
	})
}
```

**Calling sibling extensions** — import the function directly, passing `query` through:

```ts
import { getSortedHitems } from './get-sorted-hitem'
import type { Scl } from '@/v2019C1/config'

export async function getLatestHitem(
	query: Scl.Query,
): Promise<Scl.TrackedRecord<'Hitem'> | undefined> {
	const sorted = await getSortedHitems(query)
	return sorted.at(-1)
}
```

**Transaction extension** — use `Scl.Transaction` as the first arg:

```ts
import type { Scl } from '@/v2019C1/config'

export async function addHitem(
	tx: Scl.Transaction,
	params: { version: string; revision: string; who: string; what: string },
) {
	const history = (await tx.getRecordsByTagName('History'))[0]
	if (!history) return

	return tx.addChild(history, { tagName: 'Hitem', attributes: params })
}
```

## Bundling into a module

Collect the functions for one domain concept into an `index.ts` and export a module object:

```ts
// History/index.ts
import * as historyQueries from './query'
import * as historyMutations from './transaction'

export const History = {
	query: historyQueries,
	transaction: historyMutations,
}
```

If the module has no transaction methods, omit the key:

```ts
export const History = {
	query: historyQueries,
}
```

## Registering extensions

Pass all modules to `mergeExtensions` and export the result:

```ts
// extensions/index.ts
import { mergeExtensions } from '@dialecte/core/helpers'
import { History } from './History'
import { IED } from './IED'

export const EXTENSIONS = mergeExtensions({ History, IED })
```

`mergeExtensions` flattens `{ History: { query, transaction } }` into:

```ts
{
  query:       { History: historyQueries, IED: iedQueries },
  transaction: { History: historyMutations },
}
```

## Wiring into a dialecte

Pass `EXTENSIONS` to `openDialecteDocument`:

```ts
// dialecte.ts
import { openDialecteDocument } from '@dialecte/core'
import { SCL_DIALECTE_CONFIG } from './config/dialecte.config'
import { EXTENSIONS } from './extensions'

export function openSclDocument(storage: StorageOptions) {
	return openDialecteDocument({
		config: SCL_DIALECTE_CONFIG,
		storage,
		extensions: EXTENSIONS,
	})
}
```

## Consumer API

Extensions appear flat on `doc.query` and `tx`, grouped by module name:

```ts
const doc = openSclDocument({ type: 'local', databaseName: 'my-scl' })

// Query extensions
const latest = await doc.query.History.getLatestHitem()

// Transaction extensions
await doc.transaction(async (tx) => {
	await tx.History.addHitem({ version: '1', revision: '0', who: 'Alice', what: 'Initial' })
})
```

The first argument (`query`/`tx`) is bound automatically — it never appears in the call site.

## Type safety

TypeScript infers the full extension shape from `EXTENSIONS`:

- `doc.query.History` is typed with the exact functions in `historyQueries`
- `tx.History` adds transaction methods on top
- The `query` first-arg is stripped from each function's public signature
- Unknown group names and invalid argument types are caught at compile time

## Hooks — lifecycle control

Hooks run at import and export. A `beforeImportRecord` hook can auto-assign identifiers or validate structure before an element reaches the database:

```ts
beforeImportRecord(record) {
	ensureUuid(record)
	return record
}
```

This keeps domain invariants enforced at the pipeline level rather than scattered across application code.
