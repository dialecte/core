---
description: API reference for the Document class - per-file entry point for query, transaction, prepare, DocumentState, cross-tab sync, and subclassing.
---

# Document

`Document` is the per-file entry point. It owns the query and transaction surface for a single file's records. Within a [Project](/api/project), documents are obtained via `project.openDocument(id)`.

Each `Document` carries a `documentId` that scopes all store operations to its partition.

## query

Read-only access to the database. Returns a [Query](/api/query) instance.

```ts
const root = await doc.query.getRoot()
const record = await doc.query.getRecord(ref)
```

A new `Query` is created on each access - no stale state.

## transaction

Scoped unit of work. The callback receives a [Transaction](/api/transaction) - a `Query` subclass that also exposes mutation methods. All staged operations are committed atomically when the callback returns.

```ts
await doc.transaction(async (tx) => {
	const ref = await tx.addChild(root, {
		tagName: 'A',
		attributes: { aA: 'value' },
	})
	await tx.update(ref, { attributes: { aA: 'updated' } })
})
```

Concurrent transactions are **not allowed** - starting a second transaction while one is active throws `CONCURRENT_TRANSACTION`.

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

| Field        | Type                            | Description                                                                                                          |
| ------------ | ------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `operations` | `ReadonlyArray<Operation>`      | Staged operations for preview                                                                                        |
| `summary`    | `{ creates, updates, deletes }` | Counts by operation type                                                                                             |
| `query`      | `Query`                         | Read-only view of the uncommitted state — use `query.getSnapshot()` to preview the staged tree/XML before committing |
| `commit()`   | `() => Promise<void>`           | Apply all staged operations                                                                                          |
| `discard()`  | `() => void`                    | Throw away all staged operations                                                                                     |

## state (DocumentState)

Each `Document` exposes a reactive `state` object of type `DocumentState`:

```ts
doc.state.loading // boolean - true while busy
doc.state.error // DialecteError | null
doc.state.progress // { message, current, total } | null
doc.state.history // TransactionEntry[] - breadcrumb trail
doc.state.lastUpdate // number | null - timestamp of last commit
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

### DocumentEntry (Project-level)

At the Project level, `DocumentEntry` extends `DocumentState` with project-specific fields:

```ts
type DocumentEntry = DocumentState & {
	record: DocumentRecord
	canUndo: boolean
	canRedo: boolean
}
```

### Cross-tab sync

When a transaction commits, the document broadcasts `{ type: 'commit', documentId, timestamp }` via a `BroadcastChannel` scoped to the project name. Other `Document` instances (e.g. in other browser extensions targeting the same store) receive the update and can refetch data. Messages are filtered by `documentId` so each document only reacts to its own commits.

## close / destroy

```ts
doc.close() // close the BroadcastChannel listener
await doc.destroy() // delete the database entirely
```

## Subclassing

A dialecte package typically subclasses `Document` to wire domain-specific `Query` and `Transaction`:

```ts
class SclDocument extends Document<SclConfig> {
	protected override createQuery() {
		return new SclQuery(this.store, this.config, this.documentId)
	}

	protected override createTransaction() {
		return new SclTransaction(this.store, this.config, this.documentId, this.state, this.hooks)
	}
}
```

This makes `doc.query` return an `SclQuery` and `doc.transaction()` provide an `SclTransaction` - with all domain-specific methods available.
