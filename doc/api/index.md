---
description: Overview of the @dialecte/core public API — importXmlFiles for streaming XML into IndexedDB, Document for lifecycle management, and the Query/Transaction interfaces for reading and mutating records.
---

# API Overview

The `@dialecte/core` API is organised around three concepts:

1. **I/O** — import XML files into IndexedDB, export them back to XML
2. **Document** — open a database, query records, run transactions, undo/redo
3. **Query / Transaction** — the read and write interfaces exposed by a Document

## importXmlFiles

Streams one or more XML files through a SAX parser and persists each element tree to IndexedDB. Returns the database name created for each file.

```ts
import { importXmlFiles, TEST_DIALECTE_CONFIG } from '@dialecte/core'

const [databaseName] = await importXmlFiles({
	files: [xmlFile],
	dialecteConfig: TEST_DIALECTE_CONFIG,
})
```

| Parameter             | Type                | Default | Description                                                               |
| --------------------- | ------------------- | ------- | ------------------------------------------------------------------------- |
| `files`               | `File[]`            | —       | Files to import; must match `io.supportedFileExtensions`                  |
| `dialecteConfig`      | `AnyDialecteConfig` | —       | Schema config                                                             |
| `useCustomRecordsIds` | `boolean`           | `false` | When `true`, reads `dev:db-id` attributes as record IDs (useful in tests) |

Returns `Promise<string[]>` — one database name per successfully imported file.

## openDialecteDocument

Connects to an existing IndexedDB database and returns a `Document` instance.

```ts
import { openDialecteDocument, TEST_DIALECTE_CONFIG } from '@dialecte/core'

const doc = openDialecteDocument({
	config: TEST_DIALECTE_CONFIG,
	storage: { type: 'local', databaseName },
})
```

| Parameter    | Type                 | Description                                                                                                                                          |
| ------------ | -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `config`     | `AnyDialecteConfig`  | The config describing your XML schema                                                                                                                |
| `storage`    | `StorageOptions`     | `{ type: 'local', databaseName }` or `{ type: 'custom', store }`                                                                                     |
| `extensions` | `{ base?, custom? }` | Extension modules to bind onto `query` and `tx`. `base` holds the dialecte's built-ins; `custom` holds consumer-supplied modules. Both are optional. |

Returns `Document<Config>`. See [Document](/api/document) for the full interface.

### StorageOptions

```ts
type StorageOptions =
	| { type: 'local'; databaseName: string } // uses built-in DexieStore
	| { type: 'custom'; store: Store } // bring your own Store implementation
```

### Extensions

`base` and `custom` both accept an `ExtensionModules` record — a map of module names to `{ query?, transaction? }` objects. Core merges them before opening and throws a `DialecteError` (D6001) if the same method name appears in both. See [Writing Extensions](/guide/extensions/) for the full authoring guide.
const { xmlDocument, filename } = await exportXmlFile({
databaseName,
extension: '.xml',
withDownload: true,
dialecteConfig: TEST_DIALECTE_CONFIG,
})

```

| Parameter         | Type                 | Default | Description                                             |
| ----------------- | -------------------- | ------- | ------------------------------------------------------- |
| `databaseName`    | `string`             | —       | Database to export                                      |
| `extension`       | `SupportedExtension` | —       | File extension; must be in `io.supportedFileExtensions` |
| `withDownload`    | `boolean`            | `false` | Triggers a browser `<a download>` after export          |
| `withDatabaseIds` | `boolean`            | `false` | Include `dev:db-id` attributes in the output            |
| `dialecteConfig`  | `AnyDialecteConfig`  | —       | Schema config                                           |

Returns `Promise<{ xmlDocument: XMLDocument; filename: string }>`.

## Further reading

- [Document](/api/document) — lifecycle, state, transactions, undo/redo
- [Query](/api/query) — record lookup, descendants, attributes
- [Transaction](/api/transaction) — addChild, update, delete, deepClone
- [Hooks](/api/hooks) — transaction lifecycle hooks
- [IO](/io/) — importXmlFiles, exportXmlFile, IOConfig, IO hooks
```
