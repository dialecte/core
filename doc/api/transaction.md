---
description: API reference for Transaction — extends Query with atomic mutation methods including addChild, update, delete, deepClone, and move. All operations stage in memory and commit atomically; reads within the callback see staged changes.
---

# Transaction

`Transaction` extends [Query](/api/query) with mutation methods. It is created by `doc.transaction()` and scoped to a single unit of work. All operations are staged in memory and committed atomically when the callback returns.

Inside a transaction, all Query methods are available and **see staged changes** — reads overlay staged operations on top of store data.

## Mutation methods

### ensureChild

Gets an existing child record or creates it if absent. Idempotent — safe to call multiple times.

```ts
await doc.transaction(async (tx) => {
	const a = await tx.ensureChild(root, {
		tagName: 'A',
	})

	const aa = await tx.ensureChild(a, {
		tagName: 'AA_1',
		attributes: { aAA_1: 'foo' },
	})
})
```

The lookup is always scoped to `parentRef`'s own direct children — it never matches an element elsewhere in the document. Lookup strategy (in order):

1. **Non-empty attributes** → first direct child matching the attribute filter.
2. **No attributes, id present** → first direct child with that id.
3. **No attributes, no id (singleton)** → first existing direct child with that tag name.
4. **No match** → creates via `addChild`.

Returns `Promise<TrackedRecord<Config, ChildElement> | RawRecord<Config, ChildElement>>`.

Accepts both attribute forms (`AttributesValueObject` or `FullAttributeObject[]`). When using a `FullAttributeObject[]`, the array is converted to a key-value map before the lookup.

### addChild

Creates a new child element under a parent.

```ts
await doc.transaction(async (tx) => {
	const record = await tx.addChild(parentRef, {
		tagName: 'AA_1',
		attributes: { aAA_1: 'foo', bAA_1: 'bar' },
	})
	// record: RawRecord<Config, 'AA_1'>
})
```

The value-object `attributes` form is for **default-namespace** attributes. Author namespaced attributes with the array form — a **local** `name` plus a `namespace` (a registered namespace **key** string or a `{ prefix, uri }` object); dialecte derives the stored `prefix:local` name:

```ts
await tx.addChild(parentRef, {
	tagName: 'AA_1',
	attributes: [
		{ name: 'aAA_1', value: 'foo' },
		{ name: 'cAA_1', value: 'q', namespace: 'ext' },
	],
})
```

A prefixed authored `name` (e.g. `ext:cAA_1`) throws `PREFIXED_ATTRIBUTE_NAME`. See [Attribute namespaces](/guide/development/helpers#attribute-namespaces).

#### AddChildParams

| Field        | Type                                                  | Description                                                                                                                                                                   |
| ------------ | ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tagName`    | `ChildElement`                                        | Tag name of the child to create                                                                                                                                               |
| `attributes` | `DefaultAttributesValueObject \| AuthoredAttribute[]` | Default-namespace attributes via the value-object form; namespaced ones via the array form (`{ name, value, namespace }`). Optional when the child has no required attributes |
| `namespace`  | `Namespace`                                           | Override the element's namespace                                                                                                                                              |
| `value`      | `string`                                              | Text content of the element                                                                                                                                                   |
| `id`         | `UUID`                                                | Explicit ID (for tests with `dev:db-id`)                                                                                                                                      |

Returns `Promise<RawRecord<Config, ChildElement>>` — the full record of the newly created element.

The child's tag name is type-narrowed to the parent's allowed children. The compiler rejects invalid parent–child combinations.

### update

Updates attributes and/or text content of an existing element.

```ts
await doc.transaction(async (tx) => {
	await tx.update(ref, {
		attributes: { aAA_1: 'new-value' },
	})
})
```

#### UpdateParams

| Field        | Type                             | Description                                      |
| ------------ | -------------------------------- | ------------------------------------------------ |
| `attributes` | `Partial<AttributesValueObject>` | Attributes to update; `undefined`/`null` removes |
| `value`      | `string`                         | New text content                                 |

Returns `Promise<RawRecord<Config, Element>>`.

Setting an attribute to `undefined` or `null` removes it from the record — it will no longer appear in the XML output.

`update` fires `hooks.afterUpdated` with the old and new record. See [Hooks — afterUpdated](/api/hooks#afterupdated) for the full reference.

### delete

Deletes an element and its entire subtree.

```ts
await doc.transaction(async (tx) => {
	const parentRecord = await tx.delete(ref)
	// parentRecord: RawRecord<Config, ParentElement>
})
```

Returns `Promise<RawRecord<Config, ParentElement>>` — the updated parent record.

`delete` fires `hooks.beforeDelete` before cascading the subtree. See [Hooks — beforeDelete](/api/hooks#beforedelete) for the full reference.

::: tip
Define `beforeDelete` to clear or delete elements that reference the deleted subtree before it is removed.
:::

### deepClone

Clones a tree record (with its entire subtree) as a new child of a parent element. All IDs are regenerated.

```ts
await doc.transaction(async (tx) => {
	const tree = await tx.getTree(sourceRef)
	const { record, mappings } = await tx.deepClone(parentRef, tree)
	// record: RawRecord to the cloned root
	// mappings: [{ source, target }] -- old ID -> new ID for every element
})
```

#### CloneResult

```ts
type CloneResult<Config, Element> = {
	record: RawRecord<Config, Element>
	mappings: CloneMapping<Config>[]
}

type CloneMapping<Config> = {
	source: Ref<Config, ElementsOf<Config>> & {
		attributes: readonly AnyAttribute[]
	}
	target: Ref<Config, ElementsOf<Config>>
}
```

`source` carries the original record's attributes so hooks can recover source-side data without querying across databases.

`mappings` in `CloneResult` are scoped to the current `deepClone` call. The `afterDeepClone` hook receives `cumulativeCloneMappings` -- all mappings accumulated across the entire transaction. See [Hooks -- afterDeepClone](/api/hooks#afterdeepclone).

## Untyped namespace — `tx.any`

`tx.any` extends `query.any` with mutation methods. It provides the full read+write surface without type constraints - useful for custom/private elements or dynamic tag names.

See [Query — any namespace](/api/query#untyped-namespace-query-any) for the complete read-side reference.

```ts
await doc.transaction(async (tx) => {
	// Create a custom element
	const child = await tx.any.addChild(parentRef, {
		tagName: 'Private',
		attributes: { type: 'custom', xmlns: 'http://example.com/private' },
	})

	// Update it
	await tx.any.update(child, {
		attributes: { type: 'updated' },
	})

	// Clone a subtree
	const tree = await tx.any.getTree(child)
	const { record, mappings } = await tx.any.deepClone(otherParent, tree)

	// Delete
	await tx.any.delete(child)
})
```

### Mutation methods

| Method        | Params                              | Return                             |
| ------------- | ----------------------------------- | ---------------------------------- |
| `addChild`    | `AnyRefOrRecord, AnyAddChildParams` | `AnyRawRecord`                     |
| `ensureChild` | `AnyRefOrRecord, AnyAddChildParams` | `AnyTrackedRecord \| AnyRawRecord` |
| `update`      | `AnyRefOrRecord, AnyUpdateParams`   | `AnyRawRecord`                     |
| `delete`      | `AnyRefOrRecord`                    | `AnyRawRecord`                     |
| `deepClone`   | `AnyRefOrRecord, AnyTreeRecord`     | `CloneResult`                      |

#### AnyAddChildParams

| Field        | Type                                       | Description                      |
| ------------ | ------------------------------------------ | -------------------------------- |
| `tagName`    | `string`                                   | Tag name of the child to create  |
| `attributes` | `Record<string, string> \| AnyAttribute[]` | Attributes for the new element   |
| `namespace`  | `Namespace`                                | Override the element's namespace |
| `value`      | `string`                                   | Text content                     |
| `id`         | `string`                                   | Explicit ID (testing only)       |

#### AnyUpdateParams

| Field        | Type                                       | Description                                      |
| ------------ | ------------------------------------------ | ------------------------------------------------ |
| `attributes` | `Record<string, string> \| AnyAttribute[]` | Attributes to update; missing keys are unchanged |
| `value`      | `string`                                   | New text content                                 |

## Reading inside a transaction

Since `Transaction` extends `Query`, all query methods are available and **see staged changes**:

```ts
await doc.transaction(async (tx) => {
	const record = await tx.addChild(root, {
		tagName: 'A',
		attributes: { aA: 'new' },
	})

	// Read the staged record before commit
	const staged = await tx.getRecord(record)
	console.log(staged?.attributes.aA) // 'new'

	// Find descendants including staged elements
	const results = await tx.findDescendants(root)
})
```

## RefOrRecord

Like Query, all Transaction methods accept any `RefOrRecord` — refs, records, or relationships:

```ts
await doc.transaction(async (tx) => {
	const parent = await tx.getRecord(parentRef)
	// Pass the record directly — no need to extract a ref
	await tx.addChild(parent, { tagName: 'A', attributes: { aA: 'v' } })
})
```

## Subclassing

Add domain-specific mutations by extending `Transaction`:

```ts
class MyTransaction extends Transaction<MyConfig> {
	async createAA(aRef: RefOrRecord<MyConfig, 'A'>, params: { aAA_1: string; bAA_1?: string }) {
		return this.addChild(aRef, {
			tagName: 'AA_1',
			attributes: params,
		})
	}
}
```

The `Document` subclass wires it in via `createTransaction()`:

```ts
class MyDocument extends Document<MyConfig> {
	protected override createTransaction() {
		return new MyTransaction(this.store, this.config, this.state)
	}
}
```
