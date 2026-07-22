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

## Nesting methods into sub-groups

A module's `query`/`transaction` group can nest **arbitrarily deep**: a value is either an extension function (a leaf) or another group. This lets you organise a large module's API by sub-concept instead of flattening every method onto one level. The author decides the shape.

```ts
// a/index.ts — group methods under `aa` and `aaa`
import * as aaQueries from './aa/query'
import * as aaaQueries from './aaa/query'

export const a = {
	query: {
		aa: aaQueries, // → doc.query.a.aa.getItems()
		aaa: aaaQueries, // → doc.query.a.aaa.getItems()
	},
}
```

Nesting is preserved end to end — binding, types, and intellisense all mirror the shape you register:

```ts
await doc.query.a.aa.getItems('id') // fully typed, first-arg stripped
await doc.transaction(async (tx) => {
	await tx.a.aa.addItem({ aAA_1: 'value' })
})
```

Only the **first argument** (`query`/`tx`) is stripped, at every depth. A flat group (`{ query: aQueries }`) is just the depth-1 case of the same mechanism, so existing modules keep working unchanged.

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
- Nested sub-groups are preserved: `doc.query.a.aa.getItems` is typed with the exact function registered at that path
- The `query` first-arg is stripped from each function's public signature, at every depth
- Unknown group names and invalid argument types are caught at compile time

**Collision rule** — when `base` and `custom` share the same module key, their methods are merged at the function level. If the same function name appears in both, a `DialecteError` (`EXTENSION_METHOD_COLLISION`) is thrown immediately at document open time. Collision is never silently ignored.

## Naming the augmented document

Registering extensions changes the shape of the returned `Document`: its `query` and its `transaction` callback now carry your extension methods. To _name_ that augmented type — for a function parameter, a store, or a re-export — use the `ExtendedDocument<Config, Modules>` helper instead of hand-rolling it:

```ts
import type { ExtendedDocument } from '@dialecte/core'
import type { MyConfig } from './config'
import { MY_EXTENSION_MODULES } from './extensions'

// A Document augmented with MY_EXTENSION_MODULES, on both query.* and tx.*
type MyDocument = ExtendedDocument<MyConfig, typeof MY_EXTENSION_MODULES>

async function loadItems(doc: MyDocument): Promise<void> {
	const items = await doc.query.a.getAaItems() // typed
	await doc.transaction(async (tx) => {
		await tx.a.addAaItem({ aAA_1: 'value' }) // typed
	})
}
```

`ExtendedDocument<Config, Modules>` is defined as `Document<Config, MergedExtensions<Modules>>` — exactly what the document factory returns — so the named type never drifts from what you actually get at runtime.

::: warning Don't hand-roll the augmented shape
A manual intersection such as `BaseDocument & { query: …; transaction: … }` looks equivalent but is subtly wrong. `query` is a property, so it merges — but `transaction` is a **call signature**, and intersecting call signatures produces an _overload set_ ordered by source. The base overload wins, so the callback `tx` never exposes the bound modules. `ExtendedDocument` sidesteps this by describing the whole document in one shot.
:::

## Hydrating a one-parameter helper

A config package already knows its own `Config` and its base modules, so it can pre-bind both and expose a **single-parameter** helper. Consumers then name their document from just the modules they add, without repeating the config:

```ts
// my-dialecte/hydrated.types.ts
import type * as Core from '@dialecte/core'
import type { MyConfig } from './config'
import { MY_BASE_MODULES } from './extensions'

type BaseModules = typeof MY_BASE_MODULES

export namespace My {
	/** A document with the base modules plus the caller's custom modules. */
	export type ExtendedDocument<Custom extends Core.ExtensionModules = Record<never, never>> =
		Core.ExtendedDocument<MyConfig, BaseModules & Custom>
}
```

Downstream code — in any framework, or none — then writes:

```ts
import type { My } from 'my-dialecte'
import { localExtensions } from './local-extensions'

const LOCAL_MODULES = { local: localExtensions }

// query.local.*, tx.local.* — plus everything MY_BASE_MODULES ships — all typed.
type LocalDocument = My.ExtendedDocument<typeof LOCAL_MODULES>
```

This keeps a single source of truth: the augmentation logic lives once in core's `ExtendedDocument`, each config hydrates it into a `<Modules>`-only alias, and every consumer derives its local document type from that.

## Extending a dialecte at the consumption site

The most common place to use this is **not inside a dialecte** — it's in an application that _consumes_ one. When your app depends on a published dialecte and needs its own domain methods with full type support, you don't fork or patch the dialecte package. You register **local** extension modules alongside it and name the augmented document with the config's hydrated `ExtendedDocument<Modules>` helper.

The key is to write those local extensions in the **exact same folder structure a real dialecte extension uses** — plain `(query | tx, …args)` functions, grouped into `{ query, transaction }` modules — so the code is shaped like something that could already live inside the dialecte:

```
src/
  dialecte-extension/          # mirrors a dialecte's extensions/ folder
    index.ts                   # LOCAL_MODULES + LocalDocument
    local/
      index.ts                 # export const local = { query, transaction }
      query/
      transaction/
```

```ts
// dialecte-extension/index.ts
import type { My } from 'my-dialecte'
import { local } from './local'

export const LOCAL_MODULES = { local }
export type LocalDocument = My.ExtendedDocument<typeof LOCAL_MODULES>
```

### Put a service layer between the document and the rest of the app

The extension functions are your **business logic**; the UI, stores, and state around them are **consumption**. Route every `doc.query.*` / `doc.transaction(...)` call through a thin **service layer** so the document-access boundary lives in exactly one place:

```ts
// features/apply/apply.service.ts — the only layer that touches the document
import type { LocalDocument } from '@/dialecte-extension'

export async function applyChange(doc: LocalDocument, input: { value: string }): Promise<void> {
	await doc.transaction((tx) => tx.local.addAaItem({ aAA_1: input.value }))
}
```

The rest of the app calls `applyChange(doc, input)` and never sees `query` or `transaction`. Stores and views stay free of persistence concerns, and the logic works from any framework — or none.

### Why this shape pays off

Because the local extension is written exactly like a real dialecte extension and typed through `ExtendedDocument`, the whole thing stays decoupled from its host:

- **Self-contained** — the `dialecte-extension/` folder and its service layer depend only on the dialecte, not on the surrounding framework or app.
- **Extractable & promotable** — if the methods prove broadly useful, lift the folder **into the dialecte itself** and ship it as a `base` module. Nothing at the call sites changes: `tx.local.addAaItem(...)` reads identically whether `local` is a consumer-side module or a promoted built-in.

## Testing extension functions in isolation

Use `bindExtensions` to apply a module map onto a raw `Query` or `Transaction` instance without going through `Document`. Useful for unit tests that target a single extension function.

```ts
import { bindExtensions } from '@dialecte/core'

const bound = bindExtensions({ a: aQueries }, query)
await bound.a.getAaItems()
```

The bound shape strips the first `query`/`tx` argument from each function. The exposed signature is described by the `OmitFirstArg<F>` helper:

```ts
import type { OmitFirstArg } from '@dialecte/core'

type PublicSignature = OmitFirstArg<typeof getAaItems>
// (...args: []) => Promise<void>
```
