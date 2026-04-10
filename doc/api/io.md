---
description: Reference for the @dialecte/core IO API — importXmlFiles, exportXmlFile, IOConfig, import/export options, and IO lifecycle hooks (beforeImportRecord, afterImport).
---

# IO

The IO API handles XML file import and export outside the transaction system. It is designed for high-throughput streaming operations (large files, batch imports) and operates directly on the underlying database.

## `importXmlFiles`

Parses one or more XML files and stores their records into new database instances. Returns the created database names.

```ts
import { importXmlFiles } from '@dialecte/core'

const databaseNames = await importXmlFiles({
	files,
	dialecteConfig,
})
```

**Params**

| Param                 | Type                | Description                                                            |
| --------------------- | ------------------- | ---------------------------------------------------------------------- |
| `files`               | `File[]`            | Browser `File` objects to import                                       |
| `dialecteConfig`      | `AnyDialecteConfig` | Dialecte config — `io.supportedFileExtensions` is checked per file     |
| `useCustomRecordsIds` | `boolean`           | Keep IDs from the XML instead of generating new ones. Default: `false` |

**Returns** `Promise<string[]>` — one database name per successfully imported file. Files with unsupported extensions are skipped (logged to console).

---

## `exportXmlFile`

Serializes a stored database back to an XML document. Optionally triggers a browser download.

```ts
import { exportXmlFile } from '@dialecte/core'

const { xmlDocument, filename } = await exportXmlFile({
	dialecteConfig,
	databaseName,
	extension: 'scd',
})
```

**Params**

| Param             | Type            | Description                                                                |
| ----------------- | --------------- | -------------------------------------------------------------------------- |
| `dialecteConfig`  | `GenericConfig` | Dialecte config                                                            |
| `databaseName`    | `string`        | Database name as returned by `importXmlFiles`                              |
| `extension`       | `string`        | File extension, constrained to `dialecteConfig.io.supportedFileExtensions` |
| `withDownload`    | `boolean`       | Trigger browser file download. Default: `false`                            |
| `withDatabaseIds` | `boolean`       | Include internal database IDs in the output. Default: `false`              |

**Returns** `Promise<{ xmlDocument: XMLDocument; filename: string }>`

---

## `IOConfig`

Registered under `dialecteConfig.io`. Controls file format, chunking, and import/export lifecycle hooks.

```ts
type IOConfig = {
	supportedFileExtensions: readonly string[]
	importOptions?: Partial<ImportOptions>
	exportOptions?: Partial<ExportOptions>
	hooks?: IOHooks
}
```

### `supportedFileExtensions`

Array of accepted file extensions (without `.`). Files with other extensions are skipped during import.

### `importOptions`

Override the streaming import defaults. Partial — only set what differs.

```ts
type ImportOptions = {
	useBrowserApi: boolean // default: true
	batchSize: number // default: 2000 (records per write batch)
	chunkSize: number // default: 32768 (32 KB, SAX read chunk size)
}
```

Increase `batchSize` / `chunkSize` for faster imports on large files. Decrease them to reduce peak memory usage.

### `exportOptions`

```ts
type ExportOptions = {
	useBrowserApi: boolean // default: true
}
```

---

## IO Hooks

Registered under `dialecteConfig.io.hooks`. Fires during the import pipeline — not during transactions.

::: warning
IO hooks run outside the transaction store. Do not call `getRecord` or any store API inside IO hooks. Accumulate state in closure variables during `beforeImportRecord`, then flush in `afterImport`.
:::

### `beforeImportRecord`

Fires **per record**, in document order, synchronously during the SAX pass. Use it to index target elements (e.g. build a path-to-UUID map) for later resolution.

```ts
type IOHooks = {
	beforeImportRecord?: (params: { record: AnyRawRecord; ancestry: readonly AnyRawRecord[] }) => void
}
```

`ancestry` is top-down: `[root, ..., parent]`. No return value — use closure state.

**Example**

```ts
const uuidByPath = new Map<string, string>()

const config = {
  io: {
    hooks: {
      beforeImportRecord: ({ record, ancestry }) => {
        const uuid = record.attributes.find((a) => a.name === 'uuid')?.value
        if (!uuid) return
        const path = buildPathFromAncestry(record, ancestry)
        uuidByPath.set(path, uuid)
      },
      afterImport: async () => {
        // resolve pending path references using uuidByPath
        return { updates: [...] }
      },
    },
  },
}
```

---

### `afterImport`

Fires **once** after all records are stored. Return batched creates, updates, and deletes — applied atomically by core in order: creates → updates → deletes.

```ts
type IOHooks = {
	afterImport?: () => Promise<AfterImportResult>
}

type AfterImportResult = {
	creates?: AnyRawRecord[]
	updates?: RecordPatch[] // { recordId, ...partial record }[]
	deletes?: string[] // record IDs
	warnings?: ImportWarning[]
}

type ImportWarning = {
	type: string // discriminant owned by the dialecte
	recordId: string
	details?: Record<string, unknown>
}
```

Use `warnings` to surface unresolved references, unknown paths, or any other dialecte-specific anomalies detected during the import pass.
