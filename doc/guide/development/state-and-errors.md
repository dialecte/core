---
description: How to use DocumentState and DocumentEntry for UI feedback (loading, error, progress, history) and how to create structured errors via throwDialecteError and the invariant utility.
---

# State & Errors

## Document state

### DocumentState

Every `Document` exposes a single `state` object of type `DocumentState` that drives UI feedback. In Vue, wrap it with `reactive()` to trigger re-renders automatically.

```ts
const doc = project.openDocument(documentId)

const { loading, error, progress, history, lastUpdate } = doc.state
```

`state` is a plain data object — it does not emit change events itself. To react without polling, use [`doc.subscribe`](#reactivity-doc-subscribe): a synchronous, in-realm callback fired on every state change (progress, `loading`, undo/redo, folded cross-realm commits).

#### Fields

| Field        | Type                    | Purpose                                                      |
| ------------ | ----------------------- | ------------------------------------------------------------ |
| `loading`    | `boolean`               | `true` while a transaction, commit, undo, or redo is running |
| `error`      | `DialecteError \| null` | Last error (structured, UI-consumable)                       |
| `progress`   | `DocumentProgress`      | Two-level progress — see below                               |
| `history`    | `TransactionEntry[]`    | Breadcrumb trail of committed transactions                   |
| `lastUpdate` | `number \| null`        | Timestamp of the last successful commit (local or cross-tab) |

#### Progress — two levels, one bar

```ts
type DocumentProgress = {
	current: number // completed steps of the main plan (advanced by nextStep, close-previous)
	total: number // main plan step count, fixed by its plan({ steps })
	label: string // live caption (deepest plan's, else the main's)
	step: { current: number; total: number } | null // fine sub-progress of the deepest nested plan
} | null
```

`current`/`total` are the ONE main bar, projected from the outermost plan
(`plan()` opened when nothing else is on the stack). `step` is the deepest nested
plan of whatever long-running core op (`commit`, `deepClone`, `importTypes`, ...)
is currently running inside that main — purely cosmetic, it never changes
`current`/`total`. A bare `doc.transaction()` where a lone op opens a `plan()`
simply makes that op the main bar itself (no `step`).

```ts
v-if="doc.state.progress"
{{ doc.state.progress.label }}
{{ doc.state.progress.current }} / {{ doc.state.progress.total }}
<template v-if="doc.state.progress.step">
  ({{ doc.state.progress.step.current }} / {{ doc.state.progress.step.total }})
</template>
```

#### Reporting progress — `tx.progress`

Inside a transaction, `tx.progress` (a `ProgressReporter`) is the only writer
of `state.progress`. `doc.query` (read-only) gets a no-op reporter — reads never
report progress.

```ts
await doc.transaction(async (tx) => {
	tx.progress.plan({ steps: items.length, label: 'Applying…' }) // main bar
	for (const item of items) {
		tx.progress.nextStep(`Processing ${item.name}`) // caption + advance, one call
		await doSomething(tx, item)
	}
	// no endPlan(): the main is owned by the transaction (see below)
})
```

Progress is a **stack of plans**. `plan({ steps, label? })` pushes a level,
`nextStep(label?)` advances the innermost level, `endPlan()` pops it. `nextStep`
is close-previous: it captions the new step **and** advances the bar in one call,
closing the _previous_ step, so the first `nextStep` opens step 0 without
advancing and `current` stays = **completed** steps.

**Balancing rule:** every `plan()` you open you close with `endPlan()`, **except**
the transaction body's main plan — the transaction closes that one for you (its
`finally` runs `forceClear()`). You never inspect the stack: a nested op writes
`plan()`/`nextStep()`/`endPlan()` identically whether it runs top-level or inside
another plan. On a throw you skip `endPlan()` entirely — `forceClear()` unwinds
the whole stack.

```ts
async function cloneStuff(tx, nodes) {
	tx.progress.plan({ steps: nodes.length }) // no label → inherits the main's caption
	for (const n of nodes) tx.progress.nextStep()
	tx.progress.endPlan() // balanced close
}
```

Nested plans **compose safely**. `plan`/`endPlan` push/pop an internal stack, so
a nested op (e.g. a `deepClone` called inside an `importTypes` loop) reports into
its own frame without clobbering its caller's — the caller's frame resurfaces when
the child pops. The UI surfaces the deepest active plan as `step` (finest movement)
and its caption, falling back to the main's caption when the deepest has none.

`forceClear()` is called unconditionally by `Document.transaction`'s outer
`finally`, so `state.progress` is always cleared at the end of a transaction —
even if the callback left the main plan open (the normal case) or an unbalanced
`plan()`/`endPlan()` pair.

### Reactivity — doc.subscribe

`state` is a plain object, so a consumer needs a signal to know when it changed.
`doc.subscribe(cb)` fires `cb(terminal)` **synchronously, in this realm** on
every state mutation — progress steps, `loading` toggles, `undo`/`redo`, and
cross-realm commits folded in from the channel. It returns an unsubscribe
function.

```ts
const unsubscribe = doc.subscribe((terminal) => {
	render(doc.state) // read the live state
})
onScopeDispose(unsubscribe)
```

- `terminal` is `true` only for the final frame of an operation. A UI layer
  coalesces non-terminal frames (e.g. one repaint per animation frame) and
  flushes terminal ones immediately, so the last 100%/cleared frame is never
  dropped. Core emits every change; throttling lives in the consumer.
- `subscribe` is the **in-realm reactive signal**; the `BroadcastChannel`
  (`doc.channelName`) is the **cross-realm transport**. They are complementary:
  a folded cross-realm commit also fires `subscribe`. High-frequency progress
  never touches the channel.
- The subscriber registry lives on the owning `Project` (keyed by `documentId`),
  so every `Document` for the same file shares one set and `Project.undo`/`redo`
  reach it.

### DocumentEntry (Project-level)

At the Project level, `DocumentEntry` extends `DocumentState` with project-specific fields:

```ts
type DocumentEntry = DocumentState & {
	record: DocumentRecord
	canUndo: boolean
	canRedo: boolean
}
```

`ProjectState.documents` is a `Map<string, DocumentEntry>`.

### Lifecycle during a transaction

```
transaction start -> loading=true, error=null
  |
callback runs    -> tx.progress.plan/nextStep/endPlan (state.progress fills in)
  |
commit           -> tx.progress.plan({ steps: totalOps })/nextStep (nested plan only)
  |
success          -> loading=false, forceClear() -> progress=null, history entry added, lastUpdate set
  | (or)
failure          -> error=DialecteError, loading=false, forceClear() -> progress=null
```

### Cross-tab sync

`lastUpdate`, `canUndo`, and `canRedo` live on the shared `DocumentEntry` (one object per `documentId`, common to every `Document` and to `project.state.documents`). Every mutation source — a local commit, an other-tab commit, an `undo`/`redo` — converges through a single project channel handler that folds each message back into that entry. The channel is scoped to the project name; open `doc.channelName` to react to updates.

```ts
watch(
	() => doc.state.lastUpdate,
	() => {
		// data changed - refetch your view
	},
)
```

## DialecteError

Errors are structured, serializable objects - not raw `Error` instances. They carry enough context for UI display **and** developer debugging.

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

| Range   | Domain                | Examples                                                                                                                 |
| ------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `D0xxx` | Generic               | `UNKNOWN`, `ASSERTION_FAILED`                                                                                            |
| `D1xxx` | Store/persistence     | `STORE_COMMIT_FAILED`, `STORE_RECORD_NOT_FOUND`                                                                          |
| `D2xxx` | Element lookup        | `ELEMENT_NOT_FOUND`, `ROOT_NOT_FOUND`, `DUPLICATE_ID`                                                                    |
| `D3xxx` | Constraint violations | `INVALID_PARENT_CHILD`, `PROTECTED_ROOT`, `UNKNOWN_NAMESPACE_PREFIX`, `PREFIXED_ATTRIBUTE_NAME`, `FIXED_VALUE_VIOLATION` |
| `D4xxx` | Transaction lifecycle | `ALREADY_COMMITTED`, `CONCURRENT_TRANSACTION`                                                                            |
| `D5xxx` | Import/Export         | `EXPORT_ROOT_NOT_FOUND`, `EXPORT_ORPHAN_CHILD_REF`                                                                       |
| `D6xxx` | Config                | `EXTENSION_METHOD_COLLISION`                                                                                             |
| `D7xxx` | Project               | `UNKNOWN_CONFIG_KEY`, `FILE_NOT_REGISTERED`                                                                              |

The full catalog is in `core/src/errors/codes.ts`.

## Creating errors

### throwDialecteError

Throws a structured `DialecteError` wrapped in a real `Error` (for stack traces). The `method` field is auto-resolved from the call stack - you never need to pass it.

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
| `condition` | yes      | -                    | Value to check - if falsy, throws |
| `detail`    | yes      | -                    | Developer-facing error message    |
| `key`       | no       | `'ASSERTION_FAILED'` | Error key from the catalog        |
| `ref`       | no       | -                    | Element reference for context     |

### Stack trace resolution

Both `throwDialecteError` and `invariant` auto-resolve the `method` field from the call stack. Internal frames (`throwDialecteError`, `invariant`) are skipped so the reported method is always the actual caller:

```
core/src/document/query/query::findChildren
```

Format: `package/src/path/to/file::functionName`
