---
description: API reference for the Query class — read-only access to a dialecte store. Documents getRoot, getRecord, getRecordsByTagName, findChildren, findDescendants, findAncestors, getTree, and filtering utilities.
---

# Query

`Query` provides read-only access to a dialecte's store. It is accessed via `doc.query` and is also the base class for `Transaction` — so all query methods are available inside a transaction too.

## Record lookup

### getRoot

Returns the root element of the document. Throws a `ROOT_NOT_FOUND` error (`D2002`) if the database is empty.

```ts
const root = await doc.query.getRoot()
// TrackedRecord<Config, RootElement>
```

### getRecord

Returns a single record by ref (or any `RefOrRecord`).

```ts
const record = await doc.query.getRecord(ref)
// TrackedRecord<Config, Element> | undefined
```

Accepts a `Ref`, a `TrackedRecord`, a `RawRecord`, a `TreeRecord`, a `ParentRelationship`, or a `ChildRelationship`. The input is resolved to a `Ref` internally via `toRef()`.

### getRecords

Batch variant of `getRecord`. Returns results in the same order as the input.

```ts
const records = await doc.query.getRecords([refA, refB, refC])
// (TrackedRecord | undefined)[]
```

### getRecordsByTagName

Returns all records with a given tag name.

```ts
const all = await doc.query.getRecordsByTagName('AA_1')
// TrackedRecord<Config, 'AA_1'>[]
```

### getChild

Returns the first direct child of an element matching a given tag name. Returns `undefined` if the parent does not exist or has no matching child.

```ts
const child = await doc.query.getChild(a, 'AA_1')
// TrackedRecord<Config, 'AA_1'> | undefined
```

### getChildren

Returns all direct children of an element matching a given tag name. Returns an empty array if the parent does not exist or has no matching children.

```ts
const children = await doc.query.getChildren(a, 'AA_1')
// TrackedRecord<Config, 'AA_1'>[]
```

Both methods are type-safe: the child tag name is constrained to valid children of the parent element type by `ChildrenOf<Config, ParentElement>`.

## Finding ancestors

### findAncestors

Walks the parent chain upward from a record and returns ancestors bottom-up: `[parent, grandparent, …, root]`. The starting record is **not** included.

```ts
const ancestors = await doc.query.findAncestors(ref)
// TrackedRecord[] — [parent, grandparent, …]
```

With options:

```ts
const ancestors = await doc.query.findAncestors(ref, {
	depth: 2, // at most 2 ancestors
	stopAtTagName: 'A', // stop after collecting this element (inclusive)
})
```

#### FindAncestorsOptions

| Option          | Type                        | Description                                                                                                 |
| --------------- | --------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `depth`         | `number`                    | Maximum number of ancestors to collect. Default: unlimited.                                                 |
| `stopAtTagName` | `ElementName`               | Stop walking after collecting the first ancestor with this tag name.                                        |
| `order`         | `'bottom-up' \| 'top-down'` | Result order. `'bottom-up'` (default): `[parent, grandparent, …, root]`. `'top-down'`: `[root, …, parent]`. |

## Finding descendants

### findDescendants

Walks the subtree rooted at the given ref and returns matching descendants grouped by tag name.

```ts
const results = await doc.query.findDescendants(root)
// { A: TrackedRecord[], AA_1: TrackedRecord[], ... }
```

With a filter — only collect specific tag names along a path:

```ts
const results = await doc.query.findDescendants(root, {
	tagName: 'A',
	descendant: {
		tagName: 'AA_1',
		attributes: { aAA_1: 'foo' },
	},
})
// { A: TrackedRecord[], AA_1: TrackedRecord[] }
```

#### DescendantsFilter

```ts
type DescendantsFilter = {
	tagName: ElementName
	attributes?: FilterAttributes // match only if element has these values
	isOptional?: boolean // when true, collect if present but don't require
	descendant?: DescendantsFilter // recurse into children
}
```

#### FilterAttributes

Partial attribute match. Values can be a single value or an array of accepted values:

```ts
{
	aAA_1: 'foo'
} // exact match
{
	aAA_1: ['foo', 'bar']
} // match either
```

### findByAttributes

Find all records of a given tag name matching attribute filters.

```ts
const results = await doc.query.findByAttributes({
	tagName: 'AA_1',
	attributes: { aAA_1: 'foo' },
})
// TrackedRecord<Config, 'AA_1'>[]
```

## Tree queries

### getTree

Returns a tree-shaped record (with nested `tree[]` instead of flat `children[]`).

```ts
const tree = await doc.query.getTree(ref)
// TreeRecord<Config, Element> | undefined
```

With options to filter the tree shape:

```ts
const tree = await doc.query.getTree(ref, {
	include: [{ tagName: 'AA_1', children: [{ tagName: 'AAA_1' }] }],
	exclude: [{ tagName: 'AA_3', scope: 'self' }],
	unwrap: ['A'],
})
```

#### GetTreeParams

| Option    | Type              | Description                                    |
| --------- | ----------------- | ---------------------------------------------- |
| `include` | `IncludeFilter[]` | Only include these child elements (recursive)  |
| `exclude` | `ExcludeFilter[]` | Exclude elements matching this filter          |
| `unwrap`  | `ElementName[]`   | Skip these elements and promote their children |

**ExcludeFilter.scope:**

- `'self'` (default) — prune the entire branch
- `'children'` — keep the element but stop traversal

## Attribute queries

### getAttribute

Returns a single attribute value, or the full attribute object.

```ts
// Value only (string or empty string)
const value = await doc.query.getAttribute(ref, { name: 'aAA_1' })
// → 'foo' or ''

// Full object with namespace, qualifiedName, etc.
const attr = await doc.query.getAttribute(ref, { name: 'aAA_1', fullObject: true })
// → FullAttributeObject | undefined
```

### getAttributes

Returns all attributes as a destructurable value object, or as an array of full attribute objects.

```ts
// Value object
const { aA, bA } = await doc.query.getAttributes(ref)

// Full objects
const fullAttrs = await doc.query.getAttributes(ref, { fullObject: true })
// → FullAttributeObject[]
```

## RefOrRecord

All query methods that take a ref also accept any record type or relationship. The input is resolved to a `Ref` internally:

```ts
type RefOrRecord<Config, Element> =
	| Ref<Config, Element>
	| RawRecord<Config, Element>
	| TrackedRecord<Config, Element>
	| TreeRecord<Config, Element>
	| ParentRelationship<Config, Element>
	| ChildRelationship<Config, Element>
```

This means you can pass records directly without extracting refs:

```ts
const parent = await doc.query.getRecord(someRef)
const children = await doc.query.findDescendants(parent)
```

## Subclassing

Add domain-specific queries by extending `Query`:

```ts
class MyQuery extends Query<MyConfig> {
	async getAllA() {
		return this.getRecordsByTagName('A')
	}

	async getChildrenAA(a: RefOrRecord<MyConfig, 'A'>) {
		const results = await this.findDescendants(a, { tagName: 'AA_1' })
		return results.AA_1
	}
}
```

Domain queries have access to `this.context` and can call the same FP functions used by the core methods.
