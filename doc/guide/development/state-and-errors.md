---
description: How to use Document state for UI feedback (loading, error, progress, history) and how to create structured errors via throwDialecteError and the invariant utility.
---

# State & Errors

## Document state

Every `Document` exposes a single `state` object that drives UI feedback. In Vue, wrap it with `reactive()` to trigger re-renders automatically.

```ts
const doc = openSclDocument(storage)

const { loading, error, progress, history, lastUpdate } = doc.state
```

### Fields

| Field        | Type                                  | Purpose                                                      |
| ------------ | ------------------------------------- | ------------------------------------------------------------ |
| `loading`    | `boolean`                             | `true` while a transaction, commit, undo, or redo is running |
| `error`      | `DialecteError \| null`               | Last error (structured, UI-consumable)                       |
| `progress`   | `{ message, current, total } \| null` | Drives progress bars and status messages                     |
| `history`    | `TransactionEntry[]`                  | Breadcrumb trail of committed transactions                   |
| `lastUpdate` | `number \| null`                      | Timestamp of the last successful commit (local or cross-tab) |

```ts
// Show spinner
v-if="doc.state.loading"

// Show progress bar and message
v-if="doc.state.progress"
{{ doc.state.progress.message }}  // "Committing changes..."
{{ doc.state.progress.current }} / {{ doc.state.progress.total }}
```

### Lifecycle during a transaction

```
transaction start → loading=true, error=null
  ↓
callback runs    → (loading stays true)
  ↓
commit           → progress={ message: 'Committing changes...', current: 0, total }
  ↓
success          → loading=false, progress=null, history entry added, lastUpdate set
  ↓ (or)
failure          → error=DialecteError, loading=false, progress=null
```

### Cross-tab sync

`lastUpdate` is kept in sync across tabs via `BroadcastChannel`. When another Document instance (e.g. a different extension) commits to the same database, `lastUpdate` fires so watchers can refetch:

```ts
watch(
	() => doc.state.lastUpdate,
	() => {
		// data changed — refetch your view
	},
)
```

## DialecteError

Errors are structured, serializable objects — not raw `Error` instances. They carry enough context for UI display **and** developer debugging.

```ts
type DialecteError = {
	code: string // e.g. "D2001"
	key: DialecteErrorKey // e.g. "ELEMENT_NOT_FOUND"
	message: string // UI-consumable (toast)
	detail: string // developer-consumable (console)
	method: string // auto-resolved from stack trace
	ref?: { tagName: string; id: string }
	cause?: Error
}
```

### Error catalog

Errors use a typed catalog organized by domain:

| Range   | Domain                | Examples                                              |
| ------- | --------------------- | ----------------------------------------------------- |
| `D0xxx` | Generic               | `UNKNOWN`, `ASSERTION_FAILED`                         |
| `D1xxx` | Store/persistence     | `STORE_COMMIT_FAILED`, `STORE_RECORD_NOT_FOUND`       |
| `D2xxx` | Element lookup        | `ELEMENT_NOT_FOUND`, `ROOT_NOT_FOUND`, `DUPLICATE_ID` |
| `D3xxx` | Constraint violations | `INVALID_PARENT_CHILD`, `PROTECTED_ROOT`              |
| `D4xxx` | Transaction lifecycle | `ALREADY_COMMITTED`, `CONCURRENT_TRANSACTION`         |

The full catalog is in `core/src/errors/codes.ts`.

## Creating errors

### throwDialecteError

Throws a structured `DialecteError` wrapped in a real `Error` (for stack traces). The `method` field is auto-resolved from the call stack — you never need to pass it.

```ts
import { throwDialecteError } from '@dialecte/core'

throwDialecteError('ELEMENT_NOT_FOUND', {
	detail: 'parent record does not exist in the store',
	ref: { tagName: 'Bay', id: bay.id },
})
```

**Parameters:**

| Param     | Required | Description                                             |
| --------- | -------- | ------------------------------------------------------- |
| `key`     | yes      | Error key from the catalog (e.g. `'ELEMENT_NOT_FOUND'`) |
| `detail`  | yes      | Developer-facing explanation of what went wrong         |
| `message` | no       | Override the catalog's default UI message               |
| `ref`     | no       | Element reference for contextual error display          |
| `cause`   | no       | Original `Error` to chain                               |

### invariant

A guard that throws a structured `DialecteError` when a condition is falsy. TypeScript narrows the value after the call (`asserts condition`).

```ts
import { invariant } from '@dialecte/core/utils'

const record = await query.getRecord(ref)
invariant(record, {
	detail: `record ${ref.tagName}#${ref.id} not found`,
})
// record is narrowed to non-nullable here

invariant(record.parentRef, {
	detail: 'root element cannot be moved',
	key: 'PROTECTED_ROOT',
	ref: { tagName: record.tagName, id: record.id },
})
```

**Parameters:**

| Param       | Required | Default              | Description                       |
| ----------- | -------- | -------------------- | --------------------------------- |
| `condition` | yes      | —                    | Value to check — if falsy, throws |
| `detail`    | yes      | —                    | Developer-facing error message    |
| `key`       | no       | `'ASSERTION_FAILED'` | Error key from the catalog        |
| `ref`       | no       | —                    | Element reference for context     |

### Stack trace resolution

Both `throwDialecteError` and `invariant` auto-resolve the `method` field from the call stack. Internal frames (`throwDialecteError`, `invariant`) are skipped so the reported method is always the actual caller:

```
core/src/document/query/query::findChildren
```

Format: `package/src/path/to/file::functionName`
