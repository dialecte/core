---
description: API reference for the Query class — read-only access to a dialecte store. Documents getRoot, getRecord, getRecordsByTagName, findChildren, findDescendants, findAncestors, getTree, getSnapshot, and filtering utilities.
---

# Query

`Query` provides read-only access to a dialecte's store. It is accessed via `doc.query` and is also the base class for `Transaction` — so all query methods are available inside a transaction too.

## getFilename

Returns the filename (store name) of the document.

```ts
const filename = doc.query.getFilename()
// string
```

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

#### Transparent elements

When the dialecte config defines `transparentElements`, `getChild` and `getChildren` automatically look through those wrapper elements if no direct match is found.

**Fast path:** if a direct child matches the requested tag name, it is returned immediately - no transparent lookup occurs.

**Fallback:** if no direct match exists, both methods iterate over children of transparent wrapper types and collect matching children from inside them. Single-level only - the wrappers are not recursed.

```ts
// Config: transparentElements: ['AA_1']
//
// XML:
// <A>
//   <AA_1>
//     <AAA_1 id="aaa1" />
//     <AAA_1 id="aaa2" />
//   </AA_1>
// </A>

// getChild looks through AA_1 automatically:
const child = await doc.query.getChild(a, 'AAA_1')
// TrackedRecord for AAA_1 (first match inside AA_1)

// getChildren collects from all AA_1 wrappers:
const children = await doc.query.getChildren(a, 'AAA_1')
// TrackedRecord[] — all AAA_1 elements across all AA_1 children
```

For dynamic or untyped contexts, use [`query.any`](#untyped-namespace-query-any):

```ts
const child = await doc.query.any.getChild(a, 'AAA_1')
```

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

With options - collect specific tag names and omit branches:

```ts
const results = await doc.query.findDescendants(ref, {
	collect: { AA_1: { AAA_1: true } },
	omit: ['AA_3', { AA_1: { where: { aAA_1: 'skip' } } }],
})
// { AA_1: TrackedRecord[], AAA_1: TrackedRecord[] }
```

#### FindDescendantsParams

| Option    | Type          | Description                                                |
| --------- | ------------- | ---------------------------------------------------------- |
| `collect` | `Collect`     | Tag names to collect - string, array, or path object       |
| `omit`    | `OmitEntry[]` | Exclude branches - string or key-based object with `where` |

**collect modes:**

- `string` - single tag name at any depth
- `array` - multiple tag names, optional `where` filters per entry
- `object` - path-aware nesting (only collect in traversal order)

**omit** shares the same `OmitEntry` type as `getTree.omit` (see above).

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

Children are returned in **config order** (`config.children[parent]` sequence, unknown tags last) — the same ordering `buildXmlDocument` applies, so a tree matches its XML serialization. Ordering is the final step, after `omit`/`unwrap`.

```ts
const tree = await doc.query.getTree(ref)
// TreeRecord<Config, Element> | undefined
```

With options to filter the tree shape:

```ts
const tree = await doc.query.getTree(ref, {
	select: { AA_1: { AAA_1: true } },
	omit: ['AA_3', { AAA_2: { where: { aAAA_2: 'skip' }, scope: 'children' } }],
	unwrap: ['A'],
})
```

#### GetTreeParams

| Option   | Type            | Description                                                   |
| -------- | --------------- | ------------------------------------------------------------- |
| `select` | `TreeSelect`    | Prisma-style nested projection to pick branches               |
| `omit`   | `OmitEntry[]`   | Exclude elements - string or key-based object with conditions |
| `unwrap` | `ElementName[]` | Skip these elements and promote their children                |

#### TreeSelect

Keys are element names (PascalCase), values control traversal:

- `true` - include element and all its descendants
- `false` - exclude element at this level
- `{ ... }` - nested projection with further narrowing

Config options (camelCase):

| Option      | Type                      | Description                                                                       |
| ----------- | ------------------------- | --------------------------------------------------------------------------------- |
| `where`     | `FilterAttributes`        | Attribute filter applied to elements at this level                                |
| `recursive` | `true \| false \| number` | Control self-recursion (`true` = infinite, number = max depth, `false` = disable) |

**Auto-recursion:** Elements that contain themselves in the schema (e.g. `AAA_1` contains `AAA_1`) are automatically recursed without needing an explicit `recursive: true` flag. The same select block is re-applied at each recursive depth.

```ts
// Auto-recursion: AAA_1 contains AAA_1 per config
// No need for `recursive: true` - core detects self-recursive elements
select: {
	AA_1: {
		AAA_1: {
			AAAA_1: true
		}
	}
}
```

**Explicit self-key override:** Writing the self-tag explicitly in select disables auto-recursion and uses the explicit structure instead:

```ts
// Only recurse into AAA_1 elements matching a specific attribute
AAA_1: {
  AAA_1: { where: { aAAA_1: 'target' }, AAAA_1: true }
}
```

**Opt-out:** Set `recursive: false` to disable auto-recursion for a specific level:

```ts
AAA_1: { recursive: false, AAAA_1: true }
```

#### Transparent elements in getTree

When the config defines `transparentElements`, `getTree` handles them automatically:

1. **Select pass-through:** transparent elements are always fetched, even when not listed in select keys. Their children are matched against the parent's select - as if the wrapper didn't exist.

2. **Auto-unwrap:** transparent elements are removed from the result tree by default (their children are promoted). No need to pass `unwrap`.

```ts
// Config: transparentElements: ['AA_1']
//
// XML:
// <A aA="v">
//   <AA_1 aAA_1="wrapper">
//     <AAA_1 aAAA_1="v" />
//     <AAA_2 aAAA_2="v" />
//   </AA_1>
// </A>

// Select without mentioning AA_1 - core looks through it:
const tree = await doc.query.getTree(ref, {
	select: {
		AAA_1: true,
		AAA_2: true,
	},
})
// Result: AA_1 is unwrapped, AAA_1/AAA_2 appear as direct children of A
```

**Backward compatible:** if the transparent element IS explicitly listed in select, normal resolution applies (no pass-through, no auto-unwrap unless `unwrap` is also specified).

```ts
// Explicit AA_1 in select - behaves like any other element:
select: {
	AA_1: {
		AAA_1: true
	}
}
// Requires unwrap: ['AA_1'] to flatten
```

**Opt-out of auto-unwrap:** pass an explicit `unwrap` (even empty) to override:

```ts
// Keep transparent wrapper nodes in the tree:
const tree = await doc.query.getTree(ref, { unwrap: [] })
```

#### OmitEntry

Key-based format consistent with `collect` entries:

```ts
omit: [
	'AAA_2', // unconditional: prune all AAA_2
	{ AAA_1: { where: { aAAA_1: 'skip' } } }, // conditional: prune only matching
	{ AA_1: { scope: 'children' } }, // keep node, stop traversal
]
```

**scope:**

- `'self'` (default) — prune the entire branch
- `'children'` — keep the element but stop traversal

## Snapshots

### getSnapshot

Renders the current document state — including a transaction's **uncommitted** changes — as a tree, an XML string, or both. Reads overlay staged operations, so calling it on a live transaction or a prepared transaction's `query` shows exactly what `commit()` would write.

```ts
// Whole document, as a tree
const tree = await doc.query.getSnapshot()

// A bounded scope, as XML
const xml = await doc.query.getSnapshot({ ref, depth: 2, as: 'xml' })

// Preview uncommitted changes (see Document.prepare)
const prepared = await doc.prepare(async (tx) => tx.addChild(parent, payload))
const { tree, xmlString } = await prepared.query.getSnapshot({ as: 'both' })
```

#### GetSnapshotOptions

| Option            | Type                              | Description                                                                                                                                                                                                                                      |
| ----------------- | --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `ref`             | `RefOrRecord`                     | Scope root. Omit to start from the document root (`config.rootElementName`).                                                                                                                                                                     |
| `ancestors`       | `number`                          | Include this many ancestor levels above `ref` (spine).                                                                                                                                                                                           |
| `siblings`        | `boolean \| { expand?: boolean }` | At every ancestor-spine level, include the spine node's siblings (shows `ref` in context up the spine; implies at least `ancestors: 1`). `true` → shallow siblings; `{ expand: true }` → keep the siblings' subtrees (still bounded by `depth`). |
| `depth`           | `number`                          | Descend this many levels below the scope root (default: whole subtree). Honored even without `ref` — e.g. `{ depth: 1 }` is the root plus its direct children.                                                                                   |
| `includeDeleted`  | `boolean`                         | Re-attach staged-deleted nodes as `status: 'deleted'` tombstones (tree only).                                                                                                                                                                    |
| `omit` / `unwrap` | see [getTree](#gettree)           | Tree-shape filters, applied to the tree output only.                                                                                                                                                                                             |
| `as`              | `'tree' \| 'xml' \| 'both'`       | Output format. Default `'tree'`; `'both'` → `{ tree, xmlString }`.                                                                                                                                                                               |

**Tree vs XML:** `omit`, `unwrap` and `includeDeleted` shape the **tree** only. The **XML** always reflects the full, unfiltered document — it is what `commit()` will write. When `unwrap` is omitted, the config's transparent elements are unwrapped (as in `getTree`), so the tree matches what the UI shows.

**Ordering:** children are returned in config order (same as `getTree` and the XML), so the snapshot tree and its `xmlString` share one element order.

A scoped `ref` whose element is not the document root produces an XML **fragment** rooted at that element (no document-root attributes are stamped).

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

## Untyped namespace — `query.any`

The `any` namespace exposes the full Query surface without `ElementsOf` / `ChildrenOf` type constraints. Use it for custom/private elements (xs:any), dynamic contexts, or call sites where the element type is a union or unknown.

Access via `doc.query.any` (read-only) or `tx.any` (read + write inside a transaction - see [Transaction — any namespace](/api/transaction#untyped-namespace-tx-any)).

All methods accept plain strings for tag names and `Record<string, string>` for attributes instead of config-narrowed types.

```ts
// Read
const record = await doc.query.any.getRecord({ tagName: 'Private', id })
const attr = await doc.query.any.getAttribute(record, { name: 'customAttr' })
const attrs = await doc.query.any.getAttributes(record)
const children = await doc.query.any.getChildren(record, 'PrivateChild')
const child = await doc.query.any.getChild(record, 'PrivateChild')
const records = await doc.query.any.getRecordsByTagName('Private')
const tree = await doc.query.any.getTree(record)
const ancestors = await doc.query.any.findAncestors(record)
const descendants = await doc.query.any.findDescendants(record)
const matches = await doc.query.any.findByAttributes({
	tagName: 'Private',
	attributes: { name: 'target' },
})
```

### Type signatures

| Method                | Params                                                                | Return                                     |
| --------------------- | --------------------------------------------------------------------- | ------------------------------------------ |
| `getRecord`           | `AnyRef`                                                              | `AnyTrackedRecord \| undefined`            |
| `getRecords`          | `AnyRef[]`                                                            | `(AnyTrackedRecord \| undefined)[]`        |
| `getChild`            | `AnyRefOrRecord, tagName: string`                                     | `AnyTrackedRecord \| undefined`            |
| `getChildren`         | `AnyRefOrRecord, tagName: string`                                     | `AnyTrackedRecord[]`                       |
| `getRecordsByTagName` | `tagName: string`                                                     | `AnyTrackedRecord[]`                       |
| `getAttribute`        | `AnyRefOrRecord, { name, fullObject? }`                               | `string \| AnyAttribute \| undefined`      |
| `getAttributes`       | `AnyRefOrRecord, { fullObject? }`                                     | `Record<string, string> \| AnyAttribute[]` |
| `getTree`             | `AnyRefOrRecord`                                                      | `AnyTreeRecord \| undefined`               |
| `findAncestors`       | `AnyRefOrRecord`                                                      | `AnyTrackedRecord[]`                       |
| `findDescendants`     | `AnyRefOrRecord`                                                      | `Record<string, AnyTrackedRecord[]>`       |
| `findByAttributes`    | `{ tagName: string, attributes: Record<string, string \| string[]> }` | `AnyTrackedRecord[]`                       |

::: tip
`query.any` mirrors every public Query method except `getRoot` (always typed), `getFilename` (no element typing involved), and `findByAttributes` filter type narrowing (accepts `Record<string, string | string[]>` instead of `FilterAttributes`).
:::

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
