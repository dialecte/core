---
description: Step-by-step guide to installing @dialecte/core, opening a Project, importing an XML file, querying records, and running your first transaction.
---

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

## Step 1 - The config

A dialecte config describes the shape of your XML: its element names, allowed children, parent relationships, attributes, namespaces, and the record schema for storing them. Configs are typically generated from an XSD schema.

`@dialecte/core` exports `TEST_DIALECTE_CONFIG` - a pre-built config you can use to explore the API without writing any boilerplate:

```ts
import { TEST_DIALECTE_CONFIG } from '@dialecte/core'

// rootElementName: 'Root'
// elements: ['Root', 'A', 'B', 'C', 'AA_1', 'AA_2', 'AA_3', ...]
// namespaces: { default: { uri: 'http://dialecte.dev/XML/DEFAULT', prefix: '' },
//               ext:     { uri: 'http://dialecte.dev/XML/DEV-EXT', prefix: 'ext' }, ... }
// io.supportedFileExtensions: ['.xml']
```

> In practice you won't write this by hand. The definition generator (in progress) reads an XSD file and emits the full config automatically. `@dialecte/scl` is a real-world example.

## Step 2 - Open a Project

`Project` is a multi-document container backed by a single store. Construction is split into two steps: a sync constructor that wires up config, then `.open(name)` that connects the store.

```ts
import { Project, TEST_DIALECTE_CONFIG } from '@dialecte/core'

const project = await new Project({
	configs: { test: TEST_DIALECTE_CONFIG },
	storage: { type: 'local' },
}).open('my-project')
```

::: tip In-memory mode
Replace `{ type: 'local' }` with `{ type: 'inMemory' }` for tests or demos that don't need IndexedDB persistence. Add `writable: false` for a read-only placeholder that throws on mutations.
:::

## Step 3 - Import an XML file

`project.import` streams the file through a SAX parser and persists each element into its own store partition.

```ts
// An XML file matching TEST_DIALECTE_CONFIG:
// <Root xmlns="http://dialecte.dev/XML/DEFAULT"
//       xmlns:ext="http://dialecte.dev/XML/DEV-EXT"
//       aRoot="1">
//   <A aA="hello" bA="world">
//     <AA_1 aAA_1="foo"/>
//   </A>
// </Root>

const { documentId } = await project.import(xmlFile, { configKey: 'test' })
```

## Step 4 - Access the Document

`project.openDocument(id)` returns a `Document` scoped to the imported file.

```ts
const doc = project.openDocument(documentId)
```

The returned `Document` exposes two access paths:

- `doc.query` - read-only queries
- `doc.transaction(async (tx) => { ... })` - scoped writes

## Step 5 - Query the tree

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

## Step 6 - Mutate the tree

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

Inside a transaction, you can also query records - reads inside a transaction see staged (not-yet-committed) changes:

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

## Step 7 - Export to XML

```ts
const { xmlDocument, filename } = await project.export(documentId, {
	withDatabaseIds: false,
})
```

## Step 8 - Undo / Redo

The store keeps a per-file changelog. Undo/redo is managed at the Project level:

```ts
await project.undo(documentId)
await project.redo(documentId)
```

## Next steps

- [API - Document & Project](/api/document) - lifecycle, transactions, undo/redo
- [API - Query](/api/query) - full reference for all read methods
- [API - Transaction](/api/transaction) - full reference for all mutation methods
- [IO](/io/) - import and export pipeline
