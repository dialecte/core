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

Pass extension modules to `openDialecteDocument` under the `base` key:

```ts
// dialecte.ts
import { openDialecteDocument } from '@dialecte/core'
import { MY_CONFIG } from './config'
import { EXTENSION_MODULES } from './extensions'

export function openMyDocument(storage: StorageOptions) {
	return openDialecteDocument({
		config: MY_CONFIG,
		storage,
		extensions: { base: EXTENSION_MODULES },
	})
}
```

## Letting consumers add their own extensions

Expose a `extensions` param on the open function and pass it as `custom`. Core merges `base` and `custom` automatically and throws a `DialecteError` (D6001) if the same method name appears in both — collision is never silently ignored.

```ts
// dialecte.ts
import type { ExtensionModules } from '@dialecte/core'

export function openMyDocument<
	CustomModules extends ExtensionModules = Record<never, never>,
>(params: { storage: StorageOptions; extensions?: CustomModules }) {
	return openDialecteDocument({
		config: MY_CONFIG,
		storage: params.storage,
		extensions: { base: EXTENSION_MODULES, custom: params.extensions },
	})
}
```

Consumers then pass their own modules without importing core:

```ts
const doc = openMyDocument({
	storage: { type: 'local', databaseName },
	extensions: { myFeature: myExtension },
})
// doc.query.History.getLatestHitem()  ← built-in
// doc.query.myFeature.doSomething()   ← custom, fully typed
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
