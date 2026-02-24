# What is Dialecte?

Dialecte is an SDK for **turning an XSD schema into a fully-typed, domain-specific language (DSL)**. Point it at your XSD, generate a definition, and you get a chainable API that speaks your XML dialect natively — complete type safety, IndexedDB persistence, and streaming import/export included.

The key idea: **every XML standard that ships with an XSD can become its own Dialecte.** You own the DSL; Dialecte handles everything underneath it.

## The problem it solves

Engineering applications often revolve around large, structured XML files — substation configurations, network topologies, asset registries. Working with these files in a web application typically means:

- Writing a custom SAX or DOM parser
- Deciding how to persist elements client-side
- Building an ad-hoc query layer over that storage
- Re-deriving types from the schema by hand
- Repeating all of the above for every different XML dialect

Dialecte collapses that stack into a single, schema-driven package.

## Core concepts

### Schema-driven types

The shape of your XML is described once, in a config object. Every element name, attribute, parent–child relationship, and namespace is captured there. That config becomes the source of truth for TypeScript — the compiler knows what children an element can have, what attributes are required, and which operations are valid.

In practice you generate the config from an XSD file using the definition generator (in progress). You never write it by hand.

### Chainable API

All operations — navigation, mutation, and querying — are expressed as a **chain**. A chain starts from the root or a specific element, accumulates operations, and ends with either `.commit()` (writes) or a terminal query (reads).

```ts
// Stage two mutations, then commit atomically
await dialecte
	.fromRoot()
	.addChild({ tagName: 'A', attributes: { aA: 'value' }, setFocus: true })
	.addChild({
		tagName: 'AA_1',
		attributes: { aAA_1: 'nested' },
		setFocus: false,
	})
	.commit()
```

Chains are immutable — each method returns a new chain, so branching and composing operations has no side effects.

### IndexedDB persistence

Dialecte streams XML files through a SAX parser and writes each element to IndexedDB. Once imported, all reads and writes go through the database — no in-memory tree, no full-document re-serialisation. This keeps large files fast.

Export reconstructs the XML from IndexedDB on demand.

## Building your own dialecte

A **dialecte** is a thin package that combines three things:

1. **A generated definition** — produced by the definition generator from your XSD. Captures every element, attribute, namespace, parent–child rule, and cardinality.
2. **A config object** — wraps the definition and wires it into `@dialecte/core`.
3. **Chain extensions** _(optional)_ — domain-specific methods injected directly into the chain, fully typed against your element set. This is what graduates a config into a genuine DSL.
4. **Hooks** _(optional)_ — lifecycle callbacks that run during import, export and in the chain itself, letting you enforce invariants or enrich elements as they flow through the pipeline.

The result is a self-contained DSL package. Consumers import it and get a chain API that knows your XML dialect by heart:

```ts
// Your custom dialecte — generated from your XSD
import { createMyDialecte } from '@my-scope/my-dialecte'

const dialecte = await createMyDialecte({ databaseName })

// The chain knows your elements and attributes
await dialecte
	.fromRoot()
	.addChild({
		tagName: 'Section',
		attributes: { name: 'Intro' },
		setFocus: false,
	})
	.commit()

// Domain extension you wrote — fully typed
await dialecte.fromElement({ tagName: 'Section', id }).publishTo({ target })
```

`@dialecte/scl` is the reference implementation: it wraps `@dialecte/core` with the IEC 61850 SCL definition, SCL-specific chain extensions, and hooks.

### Extensions — shaping the DSL

Chain extensions are plain functions registered against a dialecte. Once registered, they appear as first-class methods on the chain, typed to the elements that support them:

```ts
// @dialecte/scl extension — only available on VoltageLevel chains
const result = await dialecte
	.fromElement({ tagName: 'Function', id })
	.extractTo({ target: 'function.fsd' }) // custom extension method

const tree = await dialecte.fromElement({ tagName: 'LNode', id }).resolveDataModel() // another extension
```

Extensions receive the current chain context and can call any core chain method internally. They compose naturally with built-in methods — the chain stays fluent throughout.

### Hooks — lifecycle control

Hooks can run at import, export and anywhere in the chain. A `beforeImportRecord` hook, for example, can auto-assign identifiers or validate structure before an element reaches the database:

```ts
// @dialecte/scl — ensures every element that supports uuid gets one on import
beforeImportRecord(record) {
	ensureUuid(record)    // idempotent — no-op if uuid already present
	return record
}
```

This keeps domain invariants enforced at the pipeline level rather than scattered across application code.

### The core / dialecte split

| Layer    | Package                                     | Responsibility                                                 |
| -------- | ------------------------------------------- | -------------------------------------------------------------- |
| Engine   | `@dialecte/core`                            | Parsing, storage, chain API, type system — no domain knowledge |
| Dialecte | `@dialecte/scl`, `@my-scope/my-dialecte`, … | XSD-generated definition, config, domain extensions            |

`@dialecte/core` has no knowledge of any XML standard. It only understands elements, attributes, namespaces, and trees. Your dialecte package is what makes it speak a specific language.

## What Dialecte is not

- **Not a full ORM** — it persists XML trees, not relational data
- **Not a renderer** — it manages data, not UI
