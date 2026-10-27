---
description: Reference for @dialecte/core IO utilities - parseXmlDocument, parseXmlFile and IOConfig.
---

# IO Reference

Low-level IO utilities for streaming XML in/out of the store. In most cases, use `project.import` and `project.export` instead of calling these directly.

## `parseXmlDocument`

The DOM of an XML file, in the page (`DOMParser`; a worker or Node has none).

```ts
import { parseXmlDocument } from '@dialecte/core'

const { file } = await project.export({ documentId, indent: false })
const xmlDocument = await parseXmlDocument({ file })
```

Parse the compact export (`indent: false`): the DOM then holds no whitespace-only text node, the document the stored records make. `project.export({ documentId, indent: false, xmlDocument: true })` does this for you.

**Throws** `PARSE_ERROR` when the file is not well-formed, its `detail` what the parser said.

---

## `parseXmlFile`

SAX-based streaming parser that converts an XML file into raw records persisted to a `Store`.

```ts
import { parseXmlFile } from '@dialecte/core'

const { documentId, recordCount, diagnostics } = await parseXmlFile({
	file,
	documentId: 'file-1',
	configKey: 'scl', // given to the import session the hooks create for this file
	store,
	config: dialecteConfig,
	useCustomRecordsIds: false,
})
```

**Returns** `Promise<{ documentId: string; recordCount: number; diagnostics: Diagnostic[] }>` - `diagnostics` is what the file's [import session](/io/hooks#afterimport) had to say, `[]` when nothing.

A second argument, `{ onProgress, signal }`, is told the progress after each stored batch (`{ phase: 'storing', bytesRead, totalBytes }`, never awaited) and aborts before the next batch or before the session's writes (`IMPORT_ABORTED`).

**Throws** `PARSE_ERROR` on a malformed file - its `detail` names what the parser saw (a tag not closed, text outside the root, a second root element); `meta.reason` is `'malformed-xml'` (with `meta.parser`, the parser's words) or `'second-root'` (with `meta.tagName`). The records stored before the error are the caller's to remove: [`runImport`](/io/#import-inside-the-store) (and so every store's `importFile`, `project.importFile` and `project.import`) does it.

---

## Namespaces

Import and export use one consistent namespace form (the same records serialize identically no matter how they were produced):

- **Attributes** — a default-namespace attribute is stored and serialized by its bare local name (`aA`, `root`); any non-default-namespace attribute uses `prefix:local` (`ext:cA`, `ext:root`). See [Attribute namespaces](/guide/development/helpers#attribute-namespaces).
- **Elements** — an element's namespace is resolved per parent→child context, so a local name declared in more than one namespace (bare `A` under one parent, `ext:A` under another) serializes correctly under each parent. See [Element namespaces](/guide/development/helpers#element-namespaces).
- **Foreign elements** — an element whose local name matches a schema element but carries a namespace the config does not declare (a private/vendor element) is kept verbatim on import: its namespace and attributes survive the round-trip untouched.

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
