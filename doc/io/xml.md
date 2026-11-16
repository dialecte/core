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

A second argument, `{ onProgress, signal }`, is told the progress (never awaited): after each stored batch (`{ phase: 'storing', bytesRead, totalBytes }`), then `processing` (`step: 'start'`, then each step the session's `afterImport` reports), `checking` and `applying` (`done` / `total`); the signal aborts before the next batch, between the session's steps, before its checks and before its writes (`IMPORT_ABORTED`). `finishing` is told by `runImport`, which makes the document ready.

A text value is read on XML whitespace only - space, tab, carriage return, line feed: each run of text between two tags, comments or other markup is trimmed of it and each inner run of it becomes one space, then the runs are joined (`x <!-- c --> y` reads `xy`). Every other character is kept as written: a no-break space (also written `&#160;`), a byte order mark, U+2028. CDATA is kept as written. An attribute value is read as written, but `xsi:type` and a QName-typed value: a qualified name, trimmed of XML whitespace (a list collapsed) and stored in its canonical form (a no-break space at its ends is part of the name).

**Throws** `PARSE_ERROR` on a malformed file - its `detail` names what the parser saw (a tag not closed, text outside the root, a second root element); `meta.reason` is `'malformed-xml'` (with `meta.parser`, the parser's words), `'second-root'` (with `meta.tagName`) or `'not-xml-character'`: a text value, CDATA or an attribute value holds a character XML does not allow - a control character below U+0020 but tab, line feed and carriage return, U+FFFE, U+FFFF -, as written or as a character reference (`&#11;`), with `meta.character` (`U+000B`) and the element and attribute named in `detail`. A record a hook (`afterStandardizedRecord`, `beforeImportRecord`) gave such a character in its value, an attribute value or a namespace URI fails the same way (the file's names sax reads as XML names; a name a hook writes is refused by the export, with `XML_CHARACTER_NOT_ALLOWED`); the session's own writes (`afterImport`) are refused with `XML_CHARACTER_NOT_ALLOWED`. The records stored before the error are the caller's to remove: [`runImport`](/io/#import-inside-the-store) (and so every store's `importFile`, `project.importFile` and `project.import`) does it.

---

## Namespaces

Import and export use one consistent namespace form (the same records serialize identically no matter how they were produced):

- **Attributes** — a default-namespace attribute is stored and serialized by its bare local name (`aA`, `root`); any non-default-namespace attribute uses `prefix:local` (`ext:cA`, `ext:root`). See [Attribute namespaces](/guide/development/helpers#attribute-namespaces).
- **Elements** — an element's namespace is resolved per parent→child context, so a local name declared in more than one namespace (bare `A` under one parent, `ext:A` under another) serializes correctly under each parent. See [Element namespaces](/guide/development/helpers#element-namespaces).
- **Foreign elements** — an element whose local name matches a schema element but carries a namespace the config does not declare (a private/vendor element) is kept verbatim on import: its namespace and attributes survive the round-trip untouched.

- **Namespace declarations** — no record holds an `xmlns` / `xmlns:*` attribute. Import reads each declaration where
  it stands (it decides the namespace of the names and `xsi:type` values below it), then drops it; a write
  (`addChild`, `update`, `deepClone`, an `afterStandardizedRecord` hook) given one is refused with
  `NAMESPACE_DECLARATION_NOT_ALLOWED`.
- **`xsi:type`** — stored in one form that needs no declaration: the local name for a type of the dialecte's default
  namespace (`tDD_1A`), the dialecte's prefix for one of its other namespaces (`ext:tDD_1A`), `xs:` for an XSD
  built-in (`xs:integer`, whatever prefix the file bound to XSD), and the Clark name for any other namespace
  (`{urn:f}Kind`; `{}Kind` for a type in no namespace). A value whose prefix the file binds nowhere is kept as written
  (`t:Kind`): the import does not fail, validation reports it. In a file that declares no default namespace, an
  unprefixed value names the dialecte's default, as the unprefixed elements do. On `addChild` and `update`, a value in
  one of these forms is accepted; another prefix, or a malformed Clark name, is refused with
  `UNKNOWN_NAMESPACE_PREFIX`. `deepClone` copies the stored values as they are (on an element the dialecte declares,
  its type is still judged).
- **QName and NOTATION values** — an attribute or a text the definition types `xs:QName` or `NOTATION` (a type derived
  from one included), a list of one, or a union whose value its QName member reads, is stored in the `xsi:type` form,
  resolved with the bindings in scope where it stands in the file: `f:Thing` under `xmlns:f="urn:f"` is stored
  `{urn:f}Thing`, a list item by item. A union's value is read by its first member whose lexical space admits it, as
  XSD reads it: `12` of an `integer | QName` union stays `12`, `f:Kind` becomes `{urn:f}Kind`, and `f:Kind` of a
  `string | QName` union stays a string. A value no binding resolves is kept as written. Writes store and refuse such
  values as they do `xsi:type`; a filter of `findByAttributes` on such an attribute is read the same way, so
  `{ base: 'xs:integer' }` and `{ base: '{http://www.w3.org/2001/XMLSchema}integer' }` find the same record.

Export declares every namespace the written records use (element names, attribute names, `xsi:type` and QName values) on the
written root - the document's root, or a fragment's start element - and nowhere below it, in a fixed order: `xmlns`,
`xmlns:xsi`, the dialecte's namespaces in its config order, then the others by URI; the root's own attributes follow.
Each URI gets one prefix: the dialecte's own for its namespaces, `xs` for XSD, otherwise the prefix the first record
using it was stored with, `ns1`, `ns2`... for a namespace known only from an `xsi:type` or QName value or from an unprefixed
subtree default; a prefix already taken by another URI is renamed `<prefix>2`, `<prefix>3`... The dialecte's default
namespace may also take one alias on the root, for what cannot be written unprefixed in it: an attribute of that
namespace (an unprefixed attribute is in no namespace), an `xsi:type` or QName value on an element where another
default is in force, or a NOTATION value of the default namespace (written prefixed: libxml2 reads an unprefixed
NOTATION in no namespace). A qualified name in no namespace (`{}Kind`) is written unprefixed where no default is in
force: its element declares `xmlns=""` and takes the alias, or, on the written root, the root takes the alias and binds
no default. A written root outside the dialecte's default namespace (a fragment of another namespace) binds no default
either: each default-namespace element below it declares `xmlns` on itself. The alias is the first such attribute's stored prefix when it is free, so its stored name survives an export
and a re-import, else `ns<k>`. A declaration the file had and no record uses is not exported. The only declarations
below the written root are the default namespace's: `xmlns=""` on an element in no namespace under a default, and
`xmlns="<default>"` on a default-namespace element under one in no namespace (a default has no prefix).

```xml
<!-- imported -->
<Root xmlns="urn:d" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:unused="urn:u">
	<Part xmlns:xs="http://www.w3.org/2001/XMLSchema" xmlns:f="urn:f">
		<Value xsi:type="xs:integer">5</Value>
		<f:Note/>
	</Part>
</Root>
<!-- exported -->
<Root xmlns="urn:d" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
	xmlns:xs="http://www.w3.org/2001/XMLSchema" xmlns:f="urn:f">
	<Part>
		<Value xsi:type="xs:integer">5</Value>
		<f:Note/>
	</Part>
</Root>
```

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

The file extensions the dialecte reads, with their dot (`['.scd', '.ssd']`). `.xml` is always read besides them, listed or not - a dialecte's own extension is still XML: an import's file name, an import's `path` and a new document's `path` may end in any of them or in `.xml` (compared lower-cased). Any other extension is refused (`Unsupported file type` on import, `DOCUMENT_PATH_INVALID` for a path).

The first entry (`.xml` for an empty list) is the extension core gives a new document without a path. An export names its file with the document's own extension.

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
