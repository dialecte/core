---
description: API reference for the Query class — read-only access to a dialecte store. Documents getRoot, getRecord, getRecordsByTagName, findChildren, findDescendants, findDescendantsOfEach, getChildrenOfEach, findAncestors, findAncestorsOfEach, getTree, getSnapshot, and filtering utilities.
---

# Query

`Query` provides read-only access to a dialecte's store. It is accessed via `doc.query` and is also the base class for `Transaction` — so all query methods are available inside a transaction too.

## getDocumentInfo

Returns the document's metadata record: `id`, `name`, `extension`, `configKey`, `createdAt`, and optional `metadata`. Throws a `DOCUMENT_NOT_REGISTERED` error if the document is not registered.

```ts
const { name, extension } = await doc.query.getDocumentInfo()
// DocumentRecord
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

**Reads:** staged operations and the transaction cache answer first, a ref without id resolves by its tag name, and every other ref is read in one store `getMany` (each id once). The dev perf counter `core::store::getMany` counts those calls.

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

**Fallback:** if no direct match exists, both methods iterate over children of transparent wrapper types and collect matching children from inside them. Single-level only - the wrappers are not recursed. A wrapper is looked into only in its own namespace (one the dialecte's definition declares for its tag): a same-name element in another namespace is not a wrapper.

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

### getChildrenOfEach

The children of one tag of many parents at once: one list per input position, in the input order, each as `getChildren` would answer it, transparent elements included.

```ts
const [ofA1, ofA2] = await doc.query.getChildrenOfEach([a1, a2], { tagName: 'AA_1' })
// [[AA_1 of a1, …], [AA_1 of a2, …]]
```

**Reads:** at most three store reads, whatever the number of parents. The refs given are read together in one `getMany` (a ref without an id costs its own `getByTagName`). Then one `getMany` reads the direct children of the tag of every parent, together with the transparent wrappers of the parents that have none directly; one more reads the children of the tag inside those wrappers (one level only: a wrapper inside a wrapper is not looked into), only when some parent needs it. Staged operations and the transaction cache answer first, as for `getRecords`. A record read once in the call is not read again, and a record answered at several positions is a copy at each one after the first. For 1,000 parents each with one transparent wrapper: 3 store reads, 3,000 records. The dev perf counters `core::store::getMany` and `core::store::records.getMany` count them.

- A **record** given is used as given: its `children` are followed and it is not read again. Pass a ref to have the parent read (inside a transaction, its staged version).
- A parent that does not exist answers `[]` at its position.
- A parent that names a child under another tag than its record throws `ELEMENT_TAGNAME_MISMATCH`, as `getRecords` does.
- The same parent given several times answers the same children at each position, read once.

`getChildren` makes the same reads for its one parent, and keeps reading the parent from its ref, so a record read before a staged change still answers its staged children.

## Finding ancestors

### findAncestors

Walks the parent chain upward from a record and returns ancestors bottom-up: `[parent, grandparent, …, root]`. The starting record is **not** included. The dialecte's transparent elements (`transparentElements`) are walked through and left out, as `getTree` and `getSnapshot` unwrap them: pass `unwrap: []` for every stored ancestor. Only an element in its own namespace (one the dialecte's definition declares for its tag) is walked through: a same-name element in another namespace is an ancestor like any other.

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

| Option          | Type                        | Description                                                                                                                                                                                                                     |
| --------------- | --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `depth`         | `number`                    | Maximum number of ancestors to collect. Default: unlimited.                                                                                                                                                                     |
| `stopAtTagName` | `ElementName`               | Stop walking after collecting the first ancestor with this tag name.                                                                                                                                                            |
| `order`         | `'bottom-up' \| 'top-down'` | Result order. `'bottom-up'` (default): `[parent, grandparent, …, root]`. `'top-down'`: `[root, …, parent]`.                                                                                                                     |
| `unwrap`        | `ElementName[]`             | Elements walked through and left out of the result, in their own namespace only: they take no `depth` level and `stopAtTagName` never matches them. Default: the dialecte's `transparentElements`. `[]`: every stored ancestor. |

### findAncestorsOfEach

The ancestors of many elements at once: one list per input position, in the input order, each as `findAncestors` would answer it. Takes the same options (`FindAncestorsOptions`), applied to each element.

```ts
const [ofAaa1, ofBbb1] = await doc.query.findAncestorsOfEach([aaa1, bbb1], { order: 'top-down' })
// [[Root, A, AA_1], [Root, B, BB_1]]
```

**Reads:** one store read per ancestor level, not one per level per element. The refs given are read together in one `getMany`; then the parents of each level not read yet in this call are read in one `getMany` (staged operations and the transaction cache answer first, as for `getRecords`). An ancestor shared by several elements is read once, and each list gets its own shallow copy of it (nested arrays shared). For 1,000 leaves four levels deep: 5 store reads, 1,112 records. The dev perf counter `core::store::getMany` counts those calls.

- A **record** given is used as given: its `parent` is followed and it is not read again. Pass a ref to have the element read (inside a transaction, its staged version).
- A ref that names no element answers `[]` at its position.
- The same element given several times answers the same list at each position, read once.

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

**Order:** the groups are keyed by tag name. Under an element that is not the document root, a flat collect (string or array) answers each group in id order; under the document root, and for the path form, the records of a group come in the store's own order. Neither is document order: for descendants in document order, walk a [`getTree`](#gettree) result.

**Reads:** under an element that is not the document root, a flat collect reads the subtree top-down: the element, then one store `getMany` per level, following only the children that can hold a collected tag - a child whose tag is collected, or whose definition's descendants hold a collected tag. Content the definition does not list is followed: an element it does not know, the content of an xs:any child or of a transparent element; a collected tag the definition does not know makes the walk follow every branch. An unconditionally omitted tag is never read, a record a conditional `omit` matches is neither collected nor followed. Records moved are the branches that can hold a collected tag, calls the depth of the subtree. A descendant placed where the definition allows no such tag, under elements the definition knows, is not found there.

Under the document root, a flat collect reads the records of each tag name from the store's tag index, climbing their parent chains only when `omit` is given (it relies on every record of a document lying under its root). The path form reads level by level. Both switch to one whole-document read once a call has issued more store reads (by id or by tag name) than that read is worth for this document - its record count times a per-record cost measured on IndexedDB, and never before 128 reads. The dev perf counters `core::store::get`, `core::store::getMany`, `core::store::getByTagName`, `core::store::count` and `core::store::getByDocumentId` show which path a call took.

The element itself is answered when its own tag is collected and it matches; an element whose tag is unconditionally omitted answers nothing.

### findDescendantsOfEach

What `findDescendants` answers for each element given, one answer per input position, in the input order, with the same options (`FindDescendantsParams`) applied under each element.

```ts
const [underA1, underB1] = await doc.query.findDescendantsOfEach([a1, b1], { collect: 'AAA_1' })
// [{ AAA_1: TrackedRecord[] }, { AAA_1: [] }]
```

**Reads:** a record given is used as given (its `children` are followed, it is not read again; pass a ref to have it read, inside a transaction its staged version); the refs in one `getMany`. Then, for a flat collect under elements that are not the document root, one `getMany` per level over every element's subtree at once, as described for [`findDescendants`](#finddescendants). Sixteen scope records over 992 descendants: 5 store reads and 992 records, against 96 reads and 1,008 records for one `findDescendants` call per scope. A path collect, and a flat collect under the document root, read per element as `findDescendants` does.

- A record under two elements given (nested scopes) is answered for both.
- The same element given several times is answered at each position; each position after the first gets its own shallow copy of a record. Each position answers from what it gave: a record read before a later commit walks its own children, a ref the stored ones.
- A ref that names no element answers empty groups at its position.
- `query.any.findDescendantsOfEach(refsOrRecords)` takes no options: each element collects every descendant tag its own tag may hold, as `query.any.findDescendants`.

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

An `xsi:type` value is compared as the type it names, whatever form either side writes it in - a local name, the dialecte's prefix or a Clark name (see [`xsi:type` values](/guide/development/utils#xsi-type-values)). The same holds for the `where` of `omit` and `getTree`.

### findByAttributes

Find all records of a given tag name matching attribute filters.

```ts
const results = await doc.query.findByAttributes({
	tagName: 'AA_1',
	attributes: { aAA_1: 'foo' },
})
// TrackedRecord<Config, 'AA_1'>[]
```

A list of values matches any of them, and is one lookup however long: `{ uuid: ids }` finds every element of the tag whose `uuid` is in `ids` in one store call, instead of one call per id. On a store that looks records up by attribute (the in-memory store), the plain attributes of the filter are matched in the store and only the matches are read; elsewhere the tag is read and filtered. The answer is the same either way, staged writes of a transaction included.

An `xsi:type` filter compares the type the record names, whatever form either side writes it in: a local name, the dialecte's prefix, or a Clark name (see [`xsi:type` values](/guide/development/utils#xsi-type-values)). For an element that may take another type, the filter is typed per member: an attribute only a variant has needs no type named (`{ side: '2' }`), but is refused beside a type that does not have it ([the types of such an element](/guide/development/utils#the-types-of-an-element-that-may-take-another-type)).

## Tree queries

### getTree

Returns a tree-shaped record (with nested `tree[]` instead of flat `children[]`).

Children are returned in **config order** (`config.children[parent]` sequence, a child a wildcard admits at the wildcard's place, the rest last) — the same ordering the export writes, so a tree matches its XML serialization. Ordering is the final step, after `omit`/`unwrap`.

```ts
const tree = await doc.query.getTree(ref)
// TreeRecord<Config, Element> | undefined
```

The full tree reads the document in a single batched store call and assembles the shape in memory, so it stays fast on large documents regardless of node count.

With options to filter the tree shape:

```ts
const tree = await doc.query.getTree(ref, {
	select: { AA_1: { AAA_1: true } },
	omit: ['AA_3', { AAA_2: { where: { aAAA_2: 'skip' }, scope: 'children' } }],
	unwrap: ['A'],
})
```

#### GetTreeParams

| Option     | Type                  | Description                                                             |
| ---------- | --------------------- | ----------------------------------------------------------------------- |
| `select`   | `TreeSelect`          | Prisma-style nested projection to pick branches                         |
| `omit`     | `OmitEntry[]`         | Exclude elements - string or key-based object with conditions           |
| `unwrap`   | `ElementName[]`       | Skip these elements, in their own namespace, and promote their children |
| `depth`    | `number`              | Structural levels to expand (see below)                                 |
| `expanded` | `ReadonlySet<string>` | Only these ids open, one level each, from the root (see below)          |

#### Depth-limited reads

`depth` bounds how many structural levels `getTree` expands:

- `undefined` (default) — the full tree.
- `0` — the node alone.
- `1` — the node and its direct children.
- `n` — `n` levels below the node.

The levels counted are the ones the caller sees: an element `unwrap` hoists (by default the dialecte's transparent elements, in their own namespace only) takes no level, its children count at its parent's next level. With `unwrap: []` nothing is hoisted and every element counts.

An unexpanded node keeps its `children` refs but returns an empty `tree`, so a collapsed branch is distinguishable from a leaf — exactly what a lazy / expand-on-demand UI needs.

A bounded depth reads only the levels it needs (one batched store read per level) instead of the whole document, so a shallow expand on a large document is milliseconds rather than seconds, inside a transaction with pending writes too (staged records answer first).

#### Open frontier

`expanded` opens only the listed ids, one level each, starting from the root: a node's `tree` holds its children when its id is in the set and its parent opened. A listed id under a node that does not open is never reached, and an empty set answers the root alone. Every other node keeps its `children` refs with an empty `tree`, as past `depth`. A hoisted element opens when it is reached, its id needs no listing. With `depth` too, a node opens only when both allow it. The refs are the record's own: a hoisted element counts there even when it holds nothing, so `children.length > 0` on a node whose only child is an empty wrapper opens on an empty `tree`.

Pass the root with its `id`: a ref without one below the document root resolves by tag name, which is not always the first record of its tag a full read picks. One call rebuilds a lazy view's open frontier: an open state restored, a reload after a commit reports `unknown`, a target revealed with its ancestors in the set. It reads the root, then one batched store read per open level (a hoisted level is one more), never the whole document, on the document root too. The tree is the full `getTree` with every node not opened cut to an empty `tree`.

```ts
const frontier = await doc.query.getTree(root, { expanded: new Set([root.id, ...openIds]) })
```

#### Reads

`getTree` reads level by level and decides for each child, from its tag alone, before reading it: the `select` keys at that level (auto-recursion and the transparent elements it sees through included), a tag-only `omit`, `depth` and `expanded`. A branch it cannot keep is never read; `where` and an `omit` with `where` are checked once the child is read, before its own children are. A singleton ref without an `id` reads its root by its tag name first. A ref with an `id` below the document root reads only its own subtree by levels, with or without options: one read of the root, then one per level. Only on the document root, or a ref without an `id`, with no `select`, no tag-only `omit`, no `depth` and no `expanded`, nothing prunes and `getTree` reads the whole document once. Narrow with `select` or `omit` rather than filter the returned tree.

```ts
const root = await doc.query.getTree(ref, { depth: 1 }) // node + direct children
const hasChildren = (node) => node.children.length > 0 // collapsed vs leaf
```

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

Both apply, as `unwrap` does, only to an element in its own namespace (one the dialecte's definition declares for its tag): a same-name element in another namespace is a node like any other, takes a `depth` level and gets no select pass-through.

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

| Option                  | Type                              | Description                                                                                                                                                                                                                                                                                          |
| ----------------------- | --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ref`                   | `RefOrRecord`                     | Scope root. Omit to start from the document root (`config.rootElementName`).                                                                                                                                                                                                                         |
| `ancestors`             | `number`                          | Include this many ancestor levels above `ref` (spine).                                                                                                                                                                                                                                               |
| `siblings`              | `boolean \| { expand?: boolean }` | At every ancestor-spine level, include the spine node's siblings (shows `ref` in context up the spine; implies at least `ancestors: 1`). `true` → shallow siblings; `{ expand: true }` → keep the siblings' subtrees (still bounded by `depth`).                                                     |
| `depth`                 | `number`                          | Descend this many levels below the scope root (default: whole subtree). Honored even without `ref` — e.g. `{ depth: 1 }` is the root plus its direct children. It counts stored levels: unlike `getTree`'s `depth`, an element `unwrap` hoists still uses a level (it bounds the XML's records too). |
| `includeDeleted`        | `boolean`                         | Re-attach staged-deleted nodes as `status: 'deleted'` tombstones (tree only).                                                                                                                                                                                                                        |
| `omit` / `unwrap`       | see [getTree](#gettree)           | Tree-shape filters, applied to the tree output only.                                                                                                                                                                                                                                                 |
| `as`                    | `'tree' \| 'xml' \| 'both'`       | Output format. Default `'tree'`; `'both'` → `{ tree, xmlString }`.                                                                                                                                                                                                                                   |
| `declareNamespaces`     | `boolean`                         | XML only. Default `true`. `false` → bare fragment (literal/prefixed names, no `xmlns` declarations). See the fragment note below.                                                                                                                                                                    |
| `includeXmlDeclaration` | `boolean`                         | XML only. Default `true`. `false` → omit the XML prolog (`<?xml version="1.0" encoding="UTF-8"?>`), e.g. for an excerpt embedded in another document.                                                                                                                                                |

**Tree vs XML:** `omit`, `unwrap` and `includeDeleted` shape the **tree** only. The **XML** always reflects the full, unfiltered document — it is what `commit()` will write. When `unwrap` is omitted, the config's transparent elements are unwrapped (as in `getTree`, in their own namespace only), so the tree matches what the UI shows.

**Ordering:** children are returned in config order (same as `getTree` and the XML), so the snapshot tree and its `xmlString` share one element order.

A scoped `ref` whose element is not the document root produces an XML **fragment** rooted at that element (no document-root attributes are stamped). Pass `declareNamespaces: false` to also drop the namespace declarations, yielding a clean nested-excerpt view:

```ts
// Bare fragment: <Function name="…">…</Function> with no xmlns noise
const snippet = await prepared.query.getSnapshot({ ref, as: 'xml', declareNamespaces: false })
```

Pass `includeXmlDeclaration: false` to drop the XML prolog (`<?xml version="1.0" encoding="UTF-8"?>`) from the XML output, so the snapshot can be embedded as an excerpt inside another document:

```ts
// No <?xml …?> prolog
const embedded = await doc.query.getSnapshot({ as: 'xml', includeXmlDeclaration: false })
```

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

// Scope by namespace: read a namespaced attribute by its local name
const cA = await doc.query.getAttribute(ref, { name: 'cA', namespace: 'ext' })
```

Without `namespace`, `name` is the attribute's canonical name (bare local for the default namespace, `prefix:local` for any other). With a `namespace` key (or raw prefix for a custom namespace), `name` is the **local** name within that namespace. The `namespace` and local names are IntelliSense-scoped per element. See [Attribute namespaces](/guide/development/helpers#attribute-namespaces).

### getAttributes

Returns a destructurable value object, or an array of full attribute objects.

```ts
// Every attribute under its stored name: bare in the default namespace, prefixed otherwise
const { aA, bA, 'ext:cA': cA } = await doc.query.getAttributes(ref)

// A namespace's attributes, keyed by local name (prefix stripped)
const { cA } = await doc.query.getAttributes(ref, { namespace: 'ext' })

// Every attribute, prefixed names included
const fullAttrs = await doc.query.getAttributes(ref, { fullObject: true })
// → FullAttributeObject[]
```

Unscoped, `getAttributes(ref)` returns every attribute under the name it is stored by - unprefixed in the default namespace, `prefix:local` otherwise, `xsi:type` included - the object a write takes back. Pass `{ namespace }` to read one namespace's attributes (local-keyed), or `{ fullObject: true }` for the array of full attribute objects. The `fullObject` array is the stored attributes as they are; a record holds no namespace declaration (import drops them, a write refuses them).

#### Reading from a record

`getAttribute` and `getAttributes` read a record given in full - a `RawRecord`, `TrackedRecord` or `TreeRecord` - as it is, with no store round trip: the attributes of every `getTree` node cost no read. A ref or a relationship is fetched.

```ts
const tree = await doc.query.getTree(ref)
for (const node of tree.tree) {
	const { aAA_1 } = await doc.query.getAttributes(node) // no store read
}
```

Inside a transaction the staged operations still come first: a record held from before a staged write reads as the transaction sees it, and one deleted in the transaction reads as absent. Outside a transaction the record is a snapshot - a record held across a commit does not pick that commit up through these reads. Pass its ref (`toRef(record)`) to read the store again. The dev perf counter `core::query::getRecord.fromRecord` counts the reads served from the record given.

Once they have the record, both read it with [`readAttribute` / `readAttributes`](/guide/development/helpers#readattribute-readattributes) from `@dialecte/core/helpers`: the same reads without a query, for code that holds a record but has no query - an import pass, a pure composer. Those read the record as held, staged writes not consulted: inside a transaction, use the query.

### getDefinition

Returns the element's definition **in its context**: the declaration its parent holds when the schema declares the tag several ways, and what the type it names with `xsi:type` lets it hold. The record is fetched first, so the parent is always known.

```ts
const definition = await doc.query.getDefinition(aaa1)
definition?.attributes.details.aAAA_1?.required
// → whether `aAAA_1` is required under THIS parent (AA_1 vs AA_2, when the schema declares AAA_1 differently under each)
```

Returns `undefined` when the ref points at no record or at a tag the dialecte does not know. When you already hold the record, the synchronous `resolveDefinition({ dialecteConfig, record })` from `@dialecte/core/utils` gives the same answer without a lookup.

### Schema defaults — the `defaults` option

Every read (`getAttribute`, `getAttributes`, and their `{ fullObject: true }` forms) accepts a `defaults` option controlling how an **absent** schema attribute is filled. A stored value always wins; `defaults` only governs attributes the author omitted.

| `defaults`   | Absent attribute is filled with…                             | Use for                         |
| ------------ | ------------------------------------------------------------ | ------------------------------- |
| `'none'`     | nothing — the faithful stored-only set                       | round-trip / write ground truth |
| `'optional'` | its `fixed` value, or a non-empty `default` (default)        | reading effective values        |
| `'required'` | `'optional'` plus `required` attributes materialized as `''` | XSD-valid / export view         |

```ts
// Faithful: exactly what was authored / will be written
const stored = await doc.query.getAttributes(ref, { defaults: 'none' })

// Read view (default): fixed / non-empty default surfaced
const effective = await doc.query.getAttributes(ref)

// Export view: required attributes present (as '') for schema validity
const forExport = await doc.query.getAttributes(ref, { defaults: 'required' })
```

`getAttributes(ref, { fullObject: true })` defaults to `'optional'` too, synthesizing absent schema attributes with their schema-derived namespace. Pass `{ fullObject: true, defaults: 'none' }` for the stored-only array.

## Filter helpers

The functions behind the attribute filters and `omit` are exported from `@dialecte/core`, for an extension that filters records it already holds. Each takes the `dialecteConfig`: an `xsi:type` value is compared as the type it names.

```ts
import { applyOmit, matchesAttributeFilter, parseOmit } from '@dialecte/core'

matchesAttributeFilter({ dialecteConfig, record, attributeFilter }) // boolean - every key must match, an array value matches any of its values
const compiled = parseOmit({ omit, dialecteConfig }) // the omit entries split for traversal
const pruned = applyOmit({ tree, omit, dialecteConfig }) // the tree without the omitted descendants; the root is never dropped
```

## Validation namespace — `query.validate`

What the schema says of a value, on the state the query sees (a transaction's staged writes included); nothing is stored.

### validate.value

Whether a value may be written to an attribute - or, without `attribute`, the text - of a `tagName` child under `parent`, the child read as declared under that parent. It need not exist; the parent is read once and no ancestor. Every prefix resolves through the dialecte's namespaces (`xs` for XSD, `xml:` always bound; a Clark name `{uri}local` as itself, `{}local` in no namespace), as the write path reads it; a QName value whose prefix the dialecte does not declare is refused (`datatype`, `expected: 'QName'`), as the write refuses it. A union's value is judged by its first admitting member. `attribute` takes the write path's two forms: a typed value-object key (`'aA'`, `'ext:cA'`, `'xsi:type'`) or the full-object form `{ name, namespace }` (a local name with a `Namespace` or a config key, or the canonical `prefix:local` with its `Namespace`).

```ts
const issue = await doc.query.validate.value({
	parent: { tagName: 'A', id: 'a1' },
	tagName: 'AA_2',
	attribute: 'aAA_2',
	value: '150',
})
// { reason: 'range', actual: '150', expected: '100', facet: 'maxInclusive' }
```

Returns a `ValueIssue` or `undefined` (admitted, or not typed). Throws `ELEMENT_NOT_FOUND`, `INVALID_PARENT_CHILD`, `UNKNOWN_NAMESPACE_PREFIX` (a key prefix or namespace key the dialecte does not declare), `PREFIXED_ATTRIBUTE_NAME` (a prefixed local name in the object form) - the write path's keys - or `INVALID_ATTRIBUTE` for a wrong argument. See [Validation](/guide/development/validation#form-guard-query-validate-value).

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

| Method                  | Params                                                                | Return                                     |
| ----------------------- | --------------------------------------------------------------------- | ------------------------------------------ |
| `getRecord`             | `AnyRef`                                                              | `AnyTrackedRecord \| undefined`            |
| `getRecords`            | `AnyRef[]`                                                            | `(AnyTrackedRecord \| undefined)[]`        |
| `getChild`              | `AnyRefOrRecord, tagName: string`                                     | `AnyTrackedRecord \| undefined`            |
| `getChildren`           | `AnyRefOrRecord, tagName: string`                                     | `AnyTrackedRecord[]`                       |
| `getChildrenOfEach`     | `AnyRefOrRecord[], { tagName: string }`                               | `AnyTrackedRecord[][]`                     |
| `getRecordsByTagName`   | `tagName: string`                                                     | `AnyTrackedRecord[]`                       |
| `getAttribute`          | `AnyRefOrRecord, { name, namespace?, fullObject? }`                   | `string \| AnyAttribute \| undefined`      |
| `getAttributes`         | `AnyRefOrRecord, { namespace?, fullObject? }`                         | `Record<string, string> \| AnyAttribute[]` |
| `getTree`               | `AnyRefOrRecord`                                                      | `AnyTreeRecord \| undefined`               |
| `findAncestors`         | `AnyRefOrRecord`                                                      | `AnyTrackedRecord[]`                       |
| `findDescendants`       | `AnyRefOrRecord`                                                      | `Record<string, AnyTrackedRecord[]>`       |
| `findDescendantsOfEach` | `AnyRefOrRecord[]`                                                    | `Record<string, AnyTrackedRecord[]>[]`     |
| `findByAttributes`      | `{ tagName: string, attributes: Record<string, string \| string[]> }` | `AnyTrackedRecord[]`                       |

::: tip
`query.any` mirrors every public Query method except `getRoot` (always typed), `getDocumentInfo` (no element typing involved), and `findByAttributes` filter type narrowing (accepts `Record<string, string | string[]>` instead of `FilterAttributes`).
:::

## RefOrRecord

All query methods that take a ref also accept any record type or relationship. The input is resolved to a `Ref` internally - except by the attribute reads, which read a record given in full as it is (see [Reading from a record](#reading-from-a-record)):

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
