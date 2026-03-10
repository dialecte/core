# What is Dialecte?

Dialecte is an SDK for **turning an XSD schema into a fully-typed, domain-specific language (DSL)**. Point it at your XSD, generate a definition, and you get a Document API that speaks your XML dialect natively — complete type safety, IndexedDB persistence, and streaming import/export included.

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

### Document / Query / Transaction

All operations follow a clear separation of concerns:

- **Document** — the entry point. Owns the database connection, exposes `query` for reads and `transaction()` for writes.
- **Query** — read-only access. Get records, find descendants, read attributes.
- **Transaction** — scoped writes. Add children, update attributes, delete elements, deep-clone subtrees. All staged operations are committed atomically.

```ts
const root = await doc.query.getRoot()

await doc.transaction(async (tx) => {
	const aRef = await tx.addChild(root, {
		tagName: 'A',
		attributes: { aA: 'value' },
	})
	await tx.addChild(aRef, {
		tagName: 'AA_1',
		attributes: { aAA_1: 'nested' },
	})
})
```

Reads and writes never mix in the same scope. Transactions are atomic — either everything commits or nothing does.

### IndexedDB persistence

Dialecte streams XML files through a SAX parser and writes each element to IndexedDB. Once imported, all reads and writes go through the database — no in-memory tree, no full-document re-serialisation. This keeps large files fast.

Export reconstructs the XML from IndexedDB on demand.

## Building your own dialecte

A **dialecte** is a thin package that combines three things:

1. **A generated definition** — produced by the definition generator from your XSD. Captures every element, attribute, namespace, parent–child rule, and cardinality.
2. **A config object** — wraps the definition and wires it into `@dialecte/core`.
3. **Domain-specific subclasses** _(optional)_ — extend `Query` and `Transaction` with typed domain methods. This is what graduates a config into a genuine DSL.
4. **Hooks** _(optional)_ — lifecycle callbacks that run during import and export, letting you enforce invariants or enrich elements as they flow through the pipeline.

The result is a self-contained DSL package. Consumers import it and get a typed API that knows your XML dialect by heart:

```ts
import { openMyDocument } from '@my-scope/my-dialecte'

const doc = openMyDocument({ databaseName })

// Query knows your elements and attributes
const sections = await doc.query.findDescendants(root, {
	tagName: 'Section',
	attributes: { name: 'Intro' },
})

// Domain method on a custom SclTransaction
await doc.transaction(async (tx) => {
	await tx.publishTo(section, { target })
})
```

`@dialecte/scl` is the reference implementation: it wraps `@dialecte/core` with the IEC 61850 SCL definition and SCL-specific query/transaction extensions.

### Extensions — shaping the DSL

Domain-specific methods are added by subclassing `Query` or `Transaction`. The `Document` subclass overrides `createQuery()` and `createTransaction()` to return the domain-specific versions:

```ts
// @dialecte/scl — domain query
class SclQuery extends Query<SclConfig> {
	async getVoltageLevels(substationRef: Ref<SclConfig, 'Substation'>) {
		return this.findDescendants(substationRef, { tagName: 'VoltageLevel' })
	}
}

// @dialecte/scl — domain transaction
class SclTransaction extends Transaction<SclConfig> {
	async createBay(voltageLevelRef: Ref<SclConfig, 'VoltageLevel'>, params: BayParams) {
		return this.addChild(voltageLevelRef, {
			tagName: 'Bay',
			attributes: params,
		})
	}
}
```

### Hooks — lifecycle control

Hooks run at import and export. A `beforeImportRecord` hook, for example, can auto-assign identifiers or validate structure before an element reaches the database:

```ts
beforeImportRecord(record) {
	ensureUuid(record)
	return record
}
```

This keeps domain invariants enforced at the pipeline level rather than scattered across application code.

### The core / dialecte split

| Layer    | Package                                     | Responsibility                                                     |
| -------- | ------------------------------------------- | ------------------------------------------------------------------ |
| Engine   | `@dialecte/core`                            | Parsing, storage, Document/Query/Transaction, type system          |
| Dialecte | `@dialecte/scl`, `@my-scope/my-dialecte`, … | XSD-generated definition, config, domain query/transaction methods |

`@dialecte/core` has no knowledge of any XML standard. It only understands elements, attributes, namespaces, and trees. Your dialecte package is what makes it speak a specific language.

## What Dialecte is not

- **Not a full ORM** — it persists XML trees, not relational data
- **Not a renderer** — it manages data, not UI
