# Queries

Query methods retrieve data from the document tree. They return a `Promise` and **break the chain** — you cannot call further chain methods after a query.

## findChildren

Find direct children of the currently focused element, grouped by tag name.

```ts
const children = await chain.findChildren({ ChildTag: { name: 'filter' } })
```

### Parameters

A partial object keyed by child tag names, where each value is an attribute filter.

```ts
type FindChildrenParams = Partial<{
	[K in ChildrenOf<Config, Element>]: FilterAttributes<Config, K>
}>
```

| Name             | Type                              | Required | Description                           |
| ---------------- | --------------------------------- | -------- | ------------------------------------- |
| `[childTagName]` | `FilterAttributes<Config, Child>` | no       | Attribute filters for each child type |

### Returns

`Promise<Record<ChildTag, ChainRecord<Config, ChildTag>[]>>` — children grouped by tag name.

### Example

```ts
const result = await dialecte.goToElement({ tagName: 'A', id: 'a-001' }).findChildren({
	AA_1: { aAA_1: 'some-value' },
})

result.AA_1 // ChainRecord<Config, 'AA_1'>[]
```

## findDescendants

Find descendants of the current focus, optionally filtering by a recursive filter chain.

### Without filter — all descendants

```ts
const all = await chain.findDescendants()
```

Returns all descendants grouped by tag name, with empty arrays for types not found.

```ts
Promise<{
	[K in Element | DescendantsOf<Config, Element>]: ChainRecord<Config, K>[]
}>
```

### With filter — targeted search

```ts
const filtered = await chain.findDescendants({
	tagName: 'AA_1',
	attributes: { aAA_1: 'value' },
	descendant: {
		tagName: 'AAA_1',
		attributes: { aAAA_1: 'leaf-value' },
	},
})
```

The filter is a recursive structure with up to 10 levels of nesting:

```ts
type DescendantsFilter = {
	tagName: ElementsOf<Config>
	attributes?: FilterAttributes<Config, Element>
	descendant?: DescendantsFilter // recursive, max depth 10
}
```

Returns only the tag names mentioned in the filter:

```ts
Promise<ResultMap<Config, ExtractTags<Filter>>>
// e.g. { AA_1: [...], AAA_1: [...] }
```

### Behavior

- **No filter**: builds full tree from current focus, flattens it.
- **With filter**: queries the deepest level first via DB, walks ancestry back to current focus validating filter conditions at any depth, deduplicates.

### Example

```ts
// All descendants
const all = await dialecte.goToElement({ tagName: 'A', id: 'a-001' }).findDescendants()

// Filtered: find AAA_1 inside specific AA_1 elements
const result = await dialecte.goToElement({ tagName: 'A', id: 'a-001' }).findDescendants({
	tagName: 'AA_1',
	descendant: {
		tagName: 'AAA_1',
		attributes: { aAAA_1: 'some-value' },
	},
})

result.AA_1 // ChainRecord[]
result.AAA_1 // ChainRecord[]
```

## findDescendantsAsTree

Like `findDescendants` with a filter, but returns results as a **tree structure** instead of flat grouped records.

```ts
const trees = await chain.findDescendantsAsTree({
	tagName: 'AA_1',
	descendant: { tagName: 'AAA_1' },
})
```

### Parameters

Same as `findDescendants` with filter — `DescendantsFilter` is **required**.

### Returns

`Promise<TreeRecord<Config, FilterRootTag>[]>` — array of tree records rooted at the filter's top-level tag name.

### Example

```ts
const trees = await dialecte.goToElement({ tagName: 'A', id: 'a-001' }).findDescendantsAsTree({
	tagName: 'AA_1',
	descendant: { tagName: 'AAA_1' },
})
// Returns AA_1 trees with AAA_1 subtrees
```

## getTree

Build the full tree from the currently focused element, with optional filtering.

```ts
const tree = await chain.getTree()
```

### Parameters

All parameters are optional.

| Name      | Type                   | Description                                           |
| --------- | ---------------------- | ----------------------------------------------------- |
| `include` | `IncludeFilter`        | Recursive whitelist — only traverse matching branches |
| `exclude` | `ExcludeFilter[]`      | Blacklist with scope control                          |
| `unwrap`  | `ElementsOf<Config>[]` | Remove wrapper elements, promoting their children     |

#### IncludeFilter

Recursive whitelist typed per `ChildrenOf` at each level:

```ts
type IncludeFilter = {
	tagName: ChildrenOf<Config, Element>
	attributes?: FilterAttributes<Config, Child>
	children?: IncludeFilter[] // recursive per child type
}
```

#### ExcludeFilter

Flat blacklist with scope:

```ts
type ExcludeFilter = {
	tagName: ElementsOf<Config>
	attributes?: FilterAttributes<Config, Element>
	scope?: 'self' | 'children'
}
```

- `scope: 'self'` (default) — remove the entire branch
- `scope: 'children'` — keep the element but prune its subtree

### Returns

`Promise<TreeRecord<Config, Element>>` — the full tree from the focused element.

### Example

```ts
// Full tree
const tree = await dialecte.goToElement({ tagName: 'A', id: 'a-001' }).getTree()

// Filtered tree: only include AA_1 with their AAA_1 children
const tree = await dialecte.goToElement({ tagName: 'A', id: 'a-001' }).getTree({
	include: {
		tagName: 'AA_1',
		children: [{ tagName: 'AAA_1' }],
	},
})

// Exclude AA_3 elements (ext namespace)
const tree = await dialecte.goToElement({ tagName: 'A', id: 'a-001' }).getTree({
	exclude: [{ tagName: 'AA_3', scope: 'self' }],
})

// Unwrap: remove A wrappers, keep their children
const tree = await dialecte.goToElement({ tagName: 'Root', id: 'root-001' }).getTree({
	unwrap: ['A'],
})
```

## getAttributesValues

Get the attributes of the currently focused element as a flat name→value record.

```ts
const attrs = await chain.getAttributesValues()
```

### Parameters

None.

### Returns

`Promise<Record<AttributeName, AttributeValue>>` — flat key-value pairs.

### Example

```ts
const attrs = await dialecte.goToElement({ tagName: 'AA_1', id: 'aa1-001' }).getAttributesValues()

attrs.aAA_1 // 'some-value'
attrs.bAA_1 // 'optional-value'
```
