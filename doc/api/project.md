---
description: API reference for the Project class - multi-document container managing config registry, store lifecycle, file registry, undo/redo, and document access.
---

# Project

`Project` is the top-level container that manages multiple documents backed by a single store. It owns the config registry, the shared `BroadcastChannel`, and per-document lifecycle.

## Creating and opening a Project

`Project` construction is split into two steps: a sync constructor that wires up config, then an async `open(name)` call that connects the store.

```ts
import { Project } from '@dialecte/core'

const project = await new Project({
	configs: { scl: sclConfig },
	storage: { type: 'local' },
	extensionsRegistry: { ...sclExtensions },
	hooks: sclHooks,
}).open('my-project')
```

**Constructor - `ProjectParams`**

| Param                | Type                                | Description                                              |
| -------------------- | ----------------------------------- | -------------------------------------------------------- |
| `configs`            | `Record<string, AnyDialecteConfig>` | Config registry keyed by label                           |
| `defaultConfigKey`   | `string`                            | Used when `configKey` is omitted. Defaults to first key. |
| `storage`            | `StorageParam`                      | `{ type: 'local' }` or `{ type: 'custom', store }`       |
| `extensionsRegistry` | `ExtensionModules`                  | Extensions applied to all Documents                      |
| `hooks`              | `TransactionHooks`                  | Transaction hooks applied to all Documents               |

**`project.open(name: string): Promise<this>`**

Connects the store, hydrates existing file registrations into `project.state.documents`, and returns `this` for chaining. Accessing `project.name`, `project.store`, or `project.channel` before calling `open` throws `PROJECT_NOT_OPENED` (D7003).

::: tip Dialecte packages
Higher-level dialecte packages (e.g. `@dialecte/scl`) expose a factory function (`createSclProject`) that pre-configures the `Project` constructor. Consumer code only calls `.open(name)`.
:::

## initEmptyDocument

Registers a new empty document with a root element pre-populated from the config's definition.

```ts
const documentId = await project.initEmptyDocument({
	name: 'untitled',
	extension: '.xml',
	configKey: 'scl',
})
```

**InitEmptyDocumentOptions**

| Param       | Type                      | Default                      | Description                          |
| ----------- | ------------------------- | ---------------------------- | ------------------------------------ |
| `name`      | `string`                  | `'untitled'`                 | Filename without extension           |
| `extension` | `string`                  | Config's first supported ext | File extension including leading dot |
| `configKey` | `string`                  | `defaultConfigKey`           | Key into the configs registry        |
| `metadata`  | `Record<string, unknown>` | -                            | Extensible per-file metadata         |

**Returns** `Promise<string>` - the new documentId.

## import

Imports an XML file, streams it through SAX, and registers it as a document.

```ts
const { documentId, recordCount } = await project.import(file, {
	configKey: 'scl',
	chunkOptions: { batchSize: 5000 },
})
```

**ImportDocumentOptions**

| Param                 | Type                      | Default            | Description                                             |
| --------------------- | ------------------------- | ------------------ | ------------------------------------------------------- |
| `configKey`           | `string`                  | `defaultConfigKey` | Key into the configs registry                           |
| `metadata`            | `Record<string, unknown>` | -                  | Extensible per-file metadata                            |
| `chunkOptions`        | `Partial<ChunkOptions>`   | -                  | Override chunking defaults for SAX streaming            |
| `useCustomRecordsIds` | `boolean`                 | `false`            | Use IDs from XML attributes instead of generating UUIDs |

**Returns** `Promise<{ documentId: string; recordCount: number }>`

## export

Serializes a document's records back to XML.

```ts
const { xmlDocument, filename } = await project.export(documentId, {
	withDatabaseIds: false,
})
```

**ExportDocumentOptions**

| Param             | Type      | Default | Description                                   |
| ----------------- | --------- | ------- | --------------------------------------------- |
| `withDatabaseIds` | `boolean` | `false` | Include internal database IDs in exported XML |

**Returns** `Promise<{ xmlDocument: XMLDocument; filename: string }>`

## File registry

```ts
// Get all registered file metadata
const files: DocumentRecord[] = await project.getDocuments()

// Get a single file's metadata
const file: DocumentRecord | undefined = await project.getDocument(documentId)

// Remove a file and all its records
await project.removeDocument(documentId)
```

## Document access

`openDocument` returns a file-scoped [Document](/api/document) for querying and mutating a specific file's records.

```ts
const doc = project.openDocument(documentId)
const root = await doc.query.getRoot()
```

`getDocumentConfig` returns the dialecte config for a specific file:

```ts
const config = project.getDocumentConfig(documentId)
```

## Undo / Redo

Undo/redo is file-scoped and managed at the Project level:

```ts
await project.undo(documentId)
await project.redo(documentId)
```

Each call broadcasts the change to other Document instances via `BroadcastChannel`.

## state (ProjectState)

```ts
type ProjectState = {
	documents: Map<string, DocumentState>
	activeTransactions: number
}
```

`documents` maps each registered file's ID to its [DocumentState](/api/document#documentstate-project-level). The map is kept in sync with the store's file registry.

## Lifecycle

```ts
project.close() // close store connection and BroadcastChannel
await project.destroy() // delete the database entirely and clear state
```

## Internal

`getDatabaseInstance()` exposes the native database instance. Return type is inferred from the storage choice - no cast needed for the default `local` storage:

```ts
// storage: { type: 'local' } -> return type is Dexie, inferred
const db = project.getDatabaseInstance()

// storage: { type: 'custom', store: myStore } -> return type is ReturnType<typeof myStore.getDatabaseInstance>
const db = project.getDatabaseInstance()
```
