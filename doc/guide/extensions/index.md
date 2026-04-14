---
description: How to write and register domain-specific extensions for a dialecte. Extensions are plain functions bound onto the Query/Transaction instances, making methods like doc.query.history.getSortedHitems() available with full type safety.
---

# Writing Extensions

Extensions add domain-specific methods as plain functions registered under a named group. Once wired into `openDialecteDocument`, they appear directly on `doc.query` and on the `tx` callback argument — fully typed against your element set.

## How it works

1. **Write functions** — plain async functions whose first argument is `Scl.Query` or `Scl.Transaction`
2. **Bundle into a module** — gather related functions into `{ query, transaction }` objects
3. **Register** — collect named modules into a plain object: `{ history, dataModel, ... }`
4. **Wire** — pass the result as `extensions.base` to `openDialecteDocument`

The `Document` binds them onto each `Query`/`Transaction` instance automatically. No subclassing needed.

## Writing extension functions

Each function takes the query (or transaction) as its first argument. The remaining arguments become its public signature after binding.

> Examples below use `TestDialecteConfig` from `@dialecte/core/test` — the built-in Rule-of-3 tree with elements like `A`, `AA_1`, `AAA_1`, etc.

**Query extension** (`a/query/get-aa-items.ts`):

```ts
import type { TestDialecteConfig } from '@dialecte/core/test'
import type { Document } from '@dialecte/core'

type Query = Document<TestDialecteConfig>['query']

export async function getAaItems(query: Query): Promise<void> {}
```

**Calling sibling extensions** — import the function directly, passing `query` through:

```ts
import { getAaItems } from './get-aa-items'
import type { TestDialecteConfig } from '@dialecte/core/test'
import type { Document } from '@dialecte/core'

type Query = Document<TestDialecteConfig>['query']

export async function getLatestAaItem(query: Query): Promise<void> {
	await getAaItems(query)
}
```

**Transaction extension** (`a/transaction/add-aa-item.ts`):

```ts
import type { TestDialecteConfig } from '@dialecte/core/test'
import type { Document } from '@dialecte/core'

type Transaction = Parameters<Parameters<Document<TestDialecteConfig>['transaction']>[0]>[0]

export async function addAaItem(tx: Transaction, params: { aAA_1: string }): Promise<void> {}
```

## Bundling into a module

Collect the functions for one domain concept into an `index.ts` and export a module object. Module names are **lowercase** (camelCase for multi-word names):

```ts
// a/index.ts
import * as aQueries from './query'
import * as aTransactions from './transaction'

export const a = {
	query: aQueries,
	transaction: aTransactions,
}
```

If the module has no transaction methods, omit the key:

```ts
export const a = {
	query: aQueries,
}
```

## Registering extensions

Collect all modules into a plain object and export it:

```ts
// extensions/index.ts
import { a } from './a'
import { b } from './b'

export const MY_EXTENSION_MODULES = { a, b }
```

## Wiring into a dialecte

Pass all params as an object to `openDialecteDocument`:

```ts
// dialecte.ts
import { openDialecteDocument } from '@dialecte/core'
import { MY_CONFIG } from './config'
import { MY_EXTENSION_MODULES } from './extensions'

export function openMyDocument<
	CustomModules extends ExtensionModules = Record<never, never>,
>(params: { storage: StorageOptions; extensions?: CustomModules }) {
	return openDialecteDocument({
		config: MY_CONFIG,
		storage: params.storage,
		extensions: { base: MY_EXTENSION_MODULES, custom: params.extensions },
	})
}
```

## Letting consumers add their own extensions

The `extensions` param accepts a `custom` key. Core merges `base` and `custom` at the function level. If `base` and `custom` share the same module key (e.g. both define `a`), their methods are merged — but a `DialecteError` is thrown if the same function name appears in both groups.

Consumers pass their own modules without importing core:

```ts
const doc = openMyDocument({
	storage: { type: 'local', databaseName },
	extensions: { myFeature: myExtension },
})
// doc.query.a.getLatestAaItem()      ← built-in
// doc.query.myFeature.doSomething()  ← custom, fully typed
```

## Consumer API

Extensions appear on `doc.query` and `tx`, grouped by module name:

```ts
const doc = openMyDocument({ storage: { type: 'local', databaseName: 'my-db' } })

// Query extensions
const items = await doc.query.a.getAaItems()

// Transaction extensions
await doc.transaction(async (tx) => {
	await tx.a.addAaItem({ aAA_1: 'value' })
})
```

The first argument (`query`/`tx`) is bound automatically — it never appears in the call site.

## Type safety

TypeScript infers the full extension shape from the extension modules object:

- `doc.query.a` is typed with the exact functions in `aQueries`
- `tx.a` adds transaction methods on top
- The `query` first-arg is stripped from each function's public signature
- Unknown group names and invalid argument types are caught at compile time

**Collision rule** — when `base` and `custom` share the same module key, their methods are merged at the function level. If the same function name appears in both, a `DialecteError` (`EXTENSION_METHOD_COLLISION`) is thrown immediately at document open time. Collision is never silently ignored.
