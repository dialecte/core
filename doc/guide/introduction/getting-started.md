# Getting Started

Dialecte core is the engine behind any xml dialecte. You bring a schema-driven config; Dialecte provides the chainable API, the streaming XML parser, and the IndexedDB persistence.

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

## Step 3 — Create a dialecte instance

```ts
import { createDialecte, TEST_DIALECTE_CONFIG } from '@dialecte/core'

const dialecte = await createDialecte({
	databaseName,
	dialecteConfig: TEST_DIALECTE_CONFIG,
	extensions: {},
})
```

The returned instance exposes `fromRoot()`, `fromElement()`, and `getState()`.

## Step 4 — Query the tree

Start a chain from the root, then navigate or query:

```ts
// Get all descendants of type AA_1
const results = await dialecte.fromRoot().findDescendants({ tagName: 'AA_1' })

for (const aa1 of results.AA_1) {
	console.log(aa1.id, aa1.attributes) // { aAA_1: 'foo' }
}
```

Jump to a specific element by tag name (or id):

```ts
const { currentFocus } = await dialecte.fromElement({ tagName: 'A' }).getContext()

console.log(currentFocus.tagName) // 'A'
console.log(currentFocus.attributes) // { aA: 'hello', bA: 'world' }
```

## Step 5 — Mutate the tree

Mutations are staged on the chain and written atomically when you call `.commit()`.

```ts
await dialecte
	.fromRoot()
	.addChild({ tagName: 'A', attributes: { aA: 'new-branch' }, setFocus: true })
	.addChild({
		tagName: 'AA_1',
		attributes: { aAA_1: 'child' },
		setFocus: false,
	})
	.commit()
```

Chains are immutable — every method returns a new chain, so you can branch freely without side effects.

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

## Extensions

Extensions add domain-specific methods directly to the chain. Pass them when creating the dialecte instance:

```ts
import { createDialecte, TEST_DIALECTE_CONFIG } from '@dialecte/core'
import { MY_EXTENSIONS } from './extensions'

const dialecte = await createDialecte({
	databaseName,
	dialecteConfig: TEST_DIALECTE_CONFIG,
	extensions: MY_EXTENSIONS,
})

// Extension methods are available on the typed chain
await dialecte.fromElement({ tagName: 'A' }).myExtensionMethod()
```

## Next Steps

- [API — Entrypoints](/api/entrypoints) — `createDialecte`, `importXmlFiles`, `exportXmlFile`
- [API — Chain methods](/api/chain/) — full reference for navigation, mutations, and queries
