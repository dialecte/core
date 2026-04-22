---
description: API reference for the Document class -- the main entry point for a dialecte. Covers openDialecteDocument, createDialecteDocument, the query accessor, transaction(), prepare(), undo/redo, and the observable DocumentState.
---

# Document

`Document` is the public entry point for interacting with a dialecte database. It owns the store connection and exposes read access via `query` and write access via `transaction()`.

## Creating a Document

### openDialecteDocument

Opens a connection to an existing database. Does not create a root element.

```ts
import { openDialecteDocument, TEST_DIALECTE_CONFIG } from '@dialecte/core'

const doc = openDialecteDocument({
	config: TEST_DIALECTE_CONFIG,
	storage: { type: 'local', databaseName },
})
```

### createDialecteDocument

Creates a new database with a root element pre-populated from the config's definition. Required attributes are initialized with their `fixed`, `default`, or empty-string value.

```ts
import { createDialecteDocument, TEST_DIALECTE_CONFIG } from '@dialecte/core'

const doc = await createDialecteDocument({
	config: TEST_DIALECTE_CONFIG,
	storage: { type: 'local', databaseName },
})
// Root element already committed -- ready for queries and transactions
```

## query

Read-only access to the database. Returns a [Query](/api/query) instance.

```ts
const root = await doc.query.getRoot()
const record = await doc.query.getRecord(ref)
```

A new `Query` is created on each access — no stale state.

## transaction

Scoped unit of work. The callback receives a [Transaction](/api/transaction) — a `Query` subclass that also exposes mutation methods. All staged operations are committed atomically when the callback returns.

```ts
await doc.transaction(async (tx) => {
	const ref = await tx.addChild(root, {
		tagName: 'A',
		attributes: { aA: 'value' },
	})
	await tx.update(ref, { attributes: { aA: 'updated' } })
})
```

Concurrent transactions are **not allowed** — starting a second transaction while one is active throws `CONCURRENT_TRANSACTION`.

### Options

| Option  | Type     | Description                       |
| ------- | -------- | --------------------------------- |
| `label` | `string` | Label recorded in `state.history` |

```ts
await doc.transaction(
	async (tx) => {
		await tx.addChild(root, { tagName: 'A', attributes: { aA: 'v' } })
	},
	{ label: 'Add element A' },
)
```

## prepare

Build up operations without committing. Returns a `PreparedTransaction` with staged operations for preview, then call `commit()` to apply or `discard()` to throw away.

```ts
const prepared = await doc.prepare(async (tx) => {
	await tx.addChild(root, { tagName: 'A', attributes: { aA: 'v' } })
	await tx.deepClone(root, tree)
})

// Preview
console.log(prepared.summary) // { creates: 5, updates: 0, deletes: 0 }
console.log(prepared.operations) // ReadonlyArray<Operation>

// User confirms
await prepared.commit()

// Or discard
// prepared.discard()
```

### PreparedTransaction

| Field        | Type                            | Description                      |
| ------------ | ------------------------------- | -------------------------------- |
| `operations` | `ReadonlyArray<Operation>`      | Staged operations for preview    |
| `summary`    | `{ creates, updates, deletes }` | Counts by operation type         |
| `commit()`   | `() => Promise<void>`           | Apply all staged operations      |
| `discard()`  | `() => void`                    | Throw away all staged operations |

## undo / redo

The store keeps a changelog of committed transactions. Navigate history with:

```ts
await doc.undo()
await doc.redo()
```

Each call updates `state.history` and broadcasts the change to other `Document` instances connected to the same database (via `BroadcastChannel`).

## state

A single observable object that tracks the document lifecycle. In a reactive framework (Vue, etc.), wrap it with `reactive()` to drive the UI.

```ts
doc.state.loading // boolean — true while busy
doc.state.error // DialecteError | null
doc.state.progress // { message, current, total } | null — drives progress bars and status messages
doc.state.history // TransactionEntry[] — breadcrumb trail
doc.state.lastUpdate // number | null — timestamp of last commit (local or remote)
```

### DocumentState

```ts
type DocumentState = {
	loading: boolean
	error: DialecteError | null
	progress: { message: string; current: number; total: number } | null
	history: TransactionEntry[]
	lastUpdate: number | null
}

type TransactionEntry = {
	method: string
	message: string
	timestamp: number
	ref?: { tagName: string; id: string }
}
```

### Cross-tab sync

When a transaction commits, the document broadcasts `lastUpdate` via a `BroadcastChannel` scoped to the database name. Other `Document` instances (e.g. in other browser extensions targeting the same database) receive the update and can refetch data.

## close / destroy

```ts
doc.close() // close the store connection
await doc.destroy() // close connection and delete the database
```

## Subclassing

A dialecte package typically subclasses `Document` to wire domain-specific `Query` and `Transaction`:

```ts
class SclDocument extends Document<SclConfig> {
	protected override createQuery() {
		return new SclQuery(this.store, this.config)
	}

	protected override createTransaction() {
		return new SclTransaction(this.store, this.config, this.state)
	}
}
```

This makes `doc.query` return an `SclQuery` and `doc.transaction()` provide an `SclTransaction` — with all domain-specific methods available.
