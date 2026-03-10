# Query

`Query` provides read-only access to a dialecte's store. It is accessed via `doc.query` and is also the base class for `Transaction` — so all query methods are available inside a transaction too.

## Record lookup

### getRoot

Returns the root element of the document.

```ts
const root = await doc.query.getRoot()
// TrackedRecord<Config, RootElement> | undefined
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
const allBays = await doc.query.getRecordsByTagName('Bay')
// TrackedRecord<Config, 'Bay'>[]
```

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
	name: 'Bay1'
} // exact match
{
	name: ['Bay1', 'Bay2']
} // match either
```

### findByAttributes

Find all records of a given tag name matching attribute filters.

```ts
const bays = await doc.query.findByAttributes({
	tagName: 'Bay',
	attributes: { name: 'Bay1' },
})
// TrackedRecord<Config, 'Bay'>[]
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
const name = await doc.query.getAttribute(ref, { name: 'name' })
// → 'Bay1' or ''

// Full object with namespace, qualifiedName, etc.
const attr = await doc.query.getAttribute(ref, { name: 'name', fullObject: true })
// → FullAttributeObject | undefined
```

### getAttributes

Returns all attributes as a destructurable value object, or as an array of full attribute objects.

```ts
// Value object
const { name, desc } = await doc.query.getAttributes(ref)

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
class SclQuery extends Query<SclConfig> {
	async getSubstations() {
		return this.getRecordsByTagName('Substation')
	}

	async getVoltageLevels(substation: RefOrRecord<SclConfig, 'Substation'>) {
		const results = await this.findDescendants(substation, { tagName: 'VoltageLevel' })
		return results.VoltageLevel
	}
}
```

Domain queries have access to `this.context` and can call the same FP functions used by the core methods.
