---
description: Reference for @dialecte/core IO functions — importXmlFiles, exportXmlFile, and IOConfig.
---

# IO Reference

Standalone functions for streaming XML in/out of IndexedDB. See the [IO overview](/io/) for how they fit alongside the Document API.

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
	extension: 'xml',
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

### `hooks`

See [IO Hooks](/io/hooks) for the full reference.
