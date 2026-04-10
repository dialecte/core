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
		attributes: {},
	})

	const aa = await tx.ensureChild(a, {
		tagName: 'AA_1',
		attributes: { aAA_1: 'foo' },
	})
})
```

Lookup strategy (in order):

1. **Non-empty attributes** → `findByAttributes`, returns first match.
2. **No attributes** → `getRecord` by id (if provided) or by tagName alone for singletons.
3. **No match** → creates via `addChild`.

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

#### AddChildParams

| Field        | Type                                             | Description                              |
| ------------ | ------------------------------------------------ | ---------------------------------------- |
| `tagName`    | `ChildElement`                                   | Tag name of the child to create          |
| `attributes` | `AttributesValueObject \| FullAttributeObject[]` | Attributes for the new element           |
| `namespace`  | `Namespace`                                      | Override the element's namespace         |
| `value`      | `string`                                         | Text content of the element              |
| `id`         | `UUID`                                           | Explicit ID (for tests with `dev:db-id`) |

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
	// mappings: [{ source, target }] — old ID → new ID for every element
})
```

#### CloneResult

```ts
type CloneResult<Config, Element> = {
	record: RawRecord<Config, Element>
	mappings: CloneMapping<Config>[]
}

type CloneMapping<Config> = {
	source: Ref<Config, ElementsOf<Config>>
	target: Ref<Config, ElementsOf<Config>>
}
```

Use `mappings` to update cross-references or external data that pointed to the original elements.

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
