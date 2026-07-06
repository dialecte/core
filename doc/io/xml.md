---
description: Reference for @dialecte/core IO utilities - buildXmlDocument, parseXmlFile, downloadFile, and IOConfig.
---

# IO Reference

Low-level IO utilities for streaming XML in/out of the store. In most cases, use `project.import` and `project.export` instead of calling these directly.

## `buildXmlDocument`

Serializes an array of raw records into an `XMLDocument`.

```ts
import { buildXmlDocument } from '@dialecte/core'

const xmlDocument = buildXmlDocument({
	records,
	config: dialecteConfig,
	withDatabaseIds: false,
})
```

**Params**

| Param             | Type                | Description                                                     |
| ----------------- | ------------------- | --------------------------------------------------------------- |
| `records`         | `AnyRawRecord[]`    | Raw records to serialize                                        |
| `config`          | `AnyDialecteConfig` | Dialecte config — determines namespaces and element definitions |
| `withDatabaseIds` | `boolean`           | Include internal database IDs in the output. Default: `false`   |

**Returns** `XMLDocument`

---

## `parseXmlFile`

SAX-based streaming parser that converts an XML file into raw records persisted to a `Store`.

```ts
import { parseXmlFile } from '@dialecte/core'

const { documentId, recordCount } = await parseXmlFile({
	file,
	documentId: 'file-1',
	store,
	config: dialecteConfig,
	useCustomRecordsIds: false,
})
```

**Returns** `Promise<{ documentId: string; recordCount: number }>`

---

## `downloadFile`

Triggers a browser file download for an `XMLDocument`.

```ts
import { downloadFile } from '@dialecte/core'

downloadFile({ xmlDocument, filename: 'export.xml' })
```

---

## Namespaces

Import and export use one consistent namespace form (the same records serialize identically no matter how they were produced):

- **Attributes** — a default-namespace attribute is stored and serialized by its bare local name (`aA`, `root`); any non-default-namespace attribute uses `prefix:local` (`ext:cA`, `ext:root`). See [Attribute namespaces](/guide/development/helpers#attribute-namespaces).
- **Elements** — an element's namespace is resolved per parent→child context, so a local name declared in more than one namespace (bare `A` under one parent, `ext:A` under another) serializes correctly under each parent. See [Element namespaces](/guide/development/helpers#element-namespaces).

`xmlns` / `xmlns:*` declarations are hoisted to the root element automatically during export.

---

## `IOConfig`

Registered under `dialecteConfig.io`. Controls file format and chunking. (Lifecycle hooks are no longer here — they are provided on the `Project` instance; see [Hooks](/api/hooks).)

```ts
type IOConfig = {
	supportedFileExtensions: readonly string[]
	importOptions?: Partial<ImportOptions>
	exportOptions?: Partial<ExportOptions>
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
