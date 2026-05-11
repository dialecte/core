---
description: Reference for @dialecte/core IO utilities - buildXmlDocument, parseXmlFile, downloadFile, and IOConfig.
---

# IO Reference

Low-level IO utilities for streaming XML in/out of the store. In most cases, use `project.import` and `project.export` instead of calling these directly.

## `buildXmlDocument`

Serializes raw records from a store partition into an `XMLDocument`.

```ts
import { buildXmlDocument } from '@dialecte/core'

const { xmlDocument } = await buildXmlDocument({
	store,
	fileId: documentId,
	dialecteConfig,
	withDatabaseIds: false,
})
```

**Params**

| Param             | Type                | Description                                                     |
| ----------------- | ------------------- | --------------------------------------------------------------- |
| `store`           | `Store`             | Store instance to read records from                             |
| `fileId`          | `string`            | File partition to export                                        |
| `dialecteConfig`  | `AnyDialecteConfig` | Dialecte config - determines namespaces and element definitions |
| `withDatabaseIds` | `boolean`           | Include internal database IDs in the output. Default: `false`   |

**Returns** `Promise<{ xmlDocument: XMLDocument }>`

---

## `parseXmlFile`

SAX-based streaming parser that converts an XML file into raw records.

```ts
import { parseXmlFile } from '@dialecte/core'

const { records, rootId } = await parseXmlFile({
	file,
	documentId: 'file-1',
	store,
	config: dialecteConfig,
})
```

---

## `downloadFile`

Triggers a browser file download for an `XMLDocument`.

```ts
import { downloadFile } from '@dialecte/core'

downloadFile({ xmlDocument, filename: 'export.xml' })
```

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

Array of accepted file extensions (without `.`). Files with other extensions are rejected during import.

### `importOptions`

Override the streaming import defaults. Partial - only set what differs.

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
