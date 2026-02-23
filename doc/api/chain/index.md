# Chain API

The chain is a **lazy, fluent API** for navigating and mutating XML document trees stored in IndexedDB. Every operation is deferred until a terminal method (`commit`, `getContext`, etc.) is called.

## How it works

```ts
await dialecte
	.goToElement({ tagName: 'A', id: 'a-001' }) // navigate
	.addChild({ tagName: 'AA_1', attributes: { aAA_1: 'v1' } }) // mutate
	.goToElement({ tagName: 'BB_1', id: 'bb-002' }) // navigate
	.update({ attributes: { aBB_1: 'updated' } }) // mutate
	.commit() // persist all changes atomically
```

The chain maintains a **focus** — the currently targeted element. Methods either:

- **Move the focus** (navigation, some mutations) → return a new `Chain`
- **Read data** (queries, endings) → return a `Promise`, breaking the chain

## Method categories

### [Navigation](./navigation)

Move focus to a different element.

| Method                                    | Focus after call |
| ----------------------------------------- | ---------------- |
| [`goToElement`](./navigation#gotoelement) | Target element   |
| [`goToParent`](./navigation#gotoparent)   | Parent element   |

### [Mutations](./mutations)

Modify the document tree. Changes are staged until `commit()`.

| Method                                         | Focus after call                          |
| ---------------------------------------------- | ----------------------------------------- |
| [`addChild`](./mutations#addchild)             | Child (if `setFocus: true`) or stays      |
| [`update`](./mutations#update)                 | Stays on current                          |
| [`delete`](./mutations#delete)                 | Moves to parent                           |
| [`deepCloneChild`](./mutations#deepclonechild) | Clone root (if `setFocus: true`) or stays |

### [Queries](./queries)

Retrieve data from the tree. All return `Promise` and break the chain.

| Method                                                     | Returns                               |
| ---------------------------------------------------------- | ------------------------------------- |
| [`findChildren`](./queries#findchildren)                   | Direct children grouped by tag name   |
| [`findDescendants`](./queries#finddescendants)             | Descendants (flat or filtered)        |
| [`findDescendantsAsTree`](./queries#finddescendantsastree) | Descendants as tree structure         |
| [`getTree`](./queries#gettree)                             | Full tree with include/exclude/unwrap |
| [`getAttributesValues`](./queries#getattributesvalues)     | Flat attribute name→value record      |

### [Endings](./endings)

Terminal operations for persistence and inspection.

| Method                               | Returns                                   |
| ------------------------------------ | ----------------------------------------- |
| [`commit`](./endings#commit)         | Persists all staged operations atomically |
| [`getContext`](./endings#getcontext) | Snapshot of internal chain state          |
| [`getParent`](./endings#getparent)   | Parent record of current focus            |

## Type safety

The chain is fully generic over your dialecte configuration. All methods are constrained to only allow valid element names, attribute names, and parent-child relationships as defined by your schema.

```ts
// TypeScript knows AA_1 is a child of A
dialecte
  .goToElement({ tagName: 'A', id: 'a-001' })
  .addChild({ tagName: 'AA_1', attributes: { aAA_1: 'v1' } })

// TypeScript error: 'B' is not a child of 'A'
dialecte
  .goToElement({ tagName: 'A', id: 'a-001' })
  .addChild({ tagName: 'B', ... }) // ❌ compile error
```
