# Getting Started

Dialecte core is the engine behind any XML dialecte. You bring a schema-driven config; Dialecte provides the Document API, the streaming XML parser, and the IndexedDB persistence.

::: info Same elements throughout
Every example below uses the built-in test definition shipped with `@dialecte/core`. Its tree structure is documented in [Testing](/guide/development/testing), so you can follow the same logic across the guide.
:::

## Installation

::: code-group

```sh [npm]
$ npm i @dialecte/core
```

```sh [pnpm]
$ pnpm add @dialecte/core
```

:::

## Step 1 — The config

A dialecte config describes the shape of your XML: its element names, allowed children, parent relationships, attributes, namespaces, and the database schema for storing them. Configs are typically generated from an XSD schema.

`@dialecte/core` exports `TEST_DIALECTE_CONFIG` — a pre-built config you can use to explore the API without writing any boilerplate:

```ts
import { TEST_DIALECTE_CONFIG } from '@dialecte/core'

// rootElementName: 'Root'
// elements: ['Root', 'A', 'B', 'C', 'AA_1', 'AA_2', 'AA_3', ...]
// namespaces: { default: { uri: 'http://dialecte.dev/XML/DEFAULT', prefix: '' },
//               ext:     { uri: 'http://dialecte.dev/XML/DEV-EXT', prefix: 'ext' }, ... }
// io.supportedFileExtensions: ['.xml']
```

> In practice you won't write this by hand. The definition generator (in progress) reads an XSD file and emits the full config automatically. `@dialecte/scl` is a real-world example.

## Step 2 — Import an XML file

`importXmlFiles` streams the file through a SAX parser and persists each element to IndexedDB. It returns the database names that were created — one per file.

```ts
import { importXmlFiles, TEST_DIALECTE_CONFIG } from '@dialecte/core'

// An XML file matching TEST_DIALECTE_CONFIG:
// <Root xmlns="http://dialecte.dev/XML/DEFAULT"
//       xmlns:ext="http://dialecte.dev/XML/DEV-EXT"
//       aRoot="1">
//   <A aA="hello" bA="world">
//     <AA_1 aAA_1="foo"/>
//   </A>
// </Root>

const [databaseName] = await importXmlFiles({
	files: [xmlFile],
	dialecteConfig: TEST_DIALECTE_CONFIG,
})
```

## Step 3 — Open a document

`openDialecteDocument` connects to an existing IndexedDB database and returns a `Document` ready to use.

```ts
import { openDialecteDocument, TEST_DIALECTE_CONFIG } from '@dialecte/core'

const doc = openDialecteDocument({
	config: TEST_DIALECTE_CONFIG,
	storage: { type: 'local', databaseName },
})
```

The returned `Document` exposes two access paths:

- `doc.query` — read-only queries
- `doc.transaction(async (tx) => { ... })` — scoped writes

## Step 4 — Query the tree

Use `doc.query` to read records, find descendants, and inspect attributes:

```ts
const root = await doc.query.getRoot()

const results = await doc.query.findDescendants(root, {
	tagName: 'AA_1',
})

for (const aa1 of results.AA_1) {
	console.log(aa1.id, aa1.attributes) // { aAA_1: 'foo' }
}
```

Get a single record by ref:

```ts
const record = await doc.query.getRecord({ tagName: 'A', id: 'some-id' })
console.log(record?.attributes) // { aA: 'hello', bA: 'world' }
```

## Step 5 — Mutate the tree

Mutations happen inside a `transaction`. All operations are staged, then committed atomically when the callback returns.

```ts
await doc.transaction(async (tx) => {
	const aRef = await tx.addChild(root, {
		tagName: 'A',
		attributes: { aA: 'new-branch' },
	})

	await tx.addChild(aRef, {
		tagName: 'AA_1',
		attributes: { aAA_1: 'child' },
	})
})
```

Inside a transaction, you can also query records — reads inside a transaction see staged (not-yet-committed) changes:

```ts
await doc.transaction(async (tx) => {
	const ref = await tx.addChild(root, {
		tagName: 'A',
		attributes: { aA: 'new' },
	})

	// This reads the staged record before commit
	const record = await tx.getRecord(ref)
})
```

## Step 6 — Export to XML

```ts
import { exportXmlFile, TEST_DIALECTE_CONFIG } from '@dialecte/core'

const { xmlDocument } = await exportXmlFile({
	databaseName,
	extension: '.xml',
	withDownload: true,
	dialecteConfig: TEST_DIALECTE_CONFIG,
})
```

## Step 7 — Undo / Redo

The store keeps a changelog. Call `undo()` and `redo()` on the document:

```ts
await doc.undo()
await doc.redo()
```

## Next steps

- [API — Document](/api/document) — lifecycle, transactions, undo/redo
- [API — Query](/api/query) — full reference for all read methods
- [API — Transaction](/api/transaction) — full reference for all mutation methods
- [API — I/O](/api/) — import and export functions
