# Mutations

Mutation methods modify the document tree. They stage operations that are applied atomically when [`commit()`](./endings.md#commit) is called. All mutations return a `Chain`, enabling fluent chaining.

## addChild

Create a new child element under the currently focused element.

```ts
chain.addChild({ tagName: 'Child', attributes: { name: 'value' } })
```

### Parameters

| Name         | Type                                                   | Required | Description                                                               |
| ------------ | ------------------------------------------------------ | -------- | ------------------------------------------------------------------------- |
| `tagName`    | `ChildrenOf<Config, Element>`                          | yes      | Tag name of the child to create                                           |
| `attributes` | `AttributesValueObjectOf` \| `FullAttributeObjectOf[]` | yes      | Attributes as a key-value object or full attribute array                  |
| `id`         | `UUID`                                                 | no       | Element ID. Auto-generated via `crypto.randomUUID()` if omitted           |
| `namespace`  | `Namespace`                                            | no       | Namespace for the element. Defaults to the element's definition namespace |
| `value`      | `string`                                               | no       | Text content of the element                                               |
| `setFocus`   | `boolean`                                              | no       | Whether to move focus to the new child. Default: `false`                  |

### Returns

- `setFocus: true` → `Chain<Config, ChildElement>` — focus moves to the new child
- `setFocus: false` (default) → `Chain<Config, Element>` — focus stays on the parent

### Behavior

- Stages a `created` operation for the child and an `updated` operation for the parent (adds child ref to `children[]`).
- Calls `dialecteConfig.hooks.afterCreated` if defined.
- The record is standardized before staging.

### Example

```ts
// Add child, stay on parent
const chain = dialecte.goToElement({ tagName: 'A', id: 'a-001' }).addChild({
	tagName: 'AA_1',
	attributes: { aAA_1: 'value' },
})
// still focused on A

// Add child and move focus to it
const chain = dialecte.goToElement({ tagName: 'A', id: 'a-001' }).addChild({
	tagName: 'AA_1',
	attributes: { aAA_1: 'value' },
	setFocus: true,
})
// now focused on AA_1
```

## update

Update the currently focused element's attributes and/or text value.

```ts
chain.update({ attributes: { name: 'new-value' } })
```

### Parameters

| Name         | Type                                                                     | Required | Description                                     |
| ------------ | ------------------------------------------------------------------------ | -------- | ----------------------------------------------- |
| `attributes` | `Partial<AttributesValueObjectOf<Config, Element> \| null \| undefined>` | no       | Partial attribute update — merges with existing |
| `value`      | `string`                                                                 | no       | New text content                                |

### Returns

`Chain<Config, Element>` — focus stays on the current element.

### Behavior

- Merges new attributes with existing ones: replaces matching names, keeps others.
- Passing `undefined` or `null` as an attribute value **removes** that attribute from the record entirely.
- Attributes with value `undefined` or `null` are never written to the XML output.
- Stages an `updated` operation with both old and new records.

### Example

```ts
// Update an attribute
const chain = dialecte
	.goToElement({ tagName: 'AA_1', id: 'aa1-001' })
	.update({ attributes: { aAA_1: 'renamed' } })
// still focused on AA_1

// Remove an attribute by passing undefined
const chain = dialecte
	.goToElement({ tagName: 'AA_1', id: 'aa1-001' })
	.update({ attributes: { aAA_1: undefined } })
// aAA_1 attribute is removed from the record and will not appear in the XML output
```

## delete

Delete the currently focused element and all its descendants.

```ts
chain.delete({ parentTagName: 'ParentTag' })
```

### Parameters

| Name            | Type                         | Required | Description                               |
| --------------- | ---------------------------- | -------- | ----------------------------------------- |
| `parentTagName` | `ParentsOf<Config, Element>` | yes      | Tag name of the parent to return focus to |

### Returns

`Chain<Config, ParentElement>` — focus moves to the parent.

### Constraints

- **Not available on root elements** — typed as `never` on the root element, `undefined` at runtime.
- Recursively stages `deleted` operations for all descendants.
- Updates the parent by removing the deleted child from its `children[]`.

### Example

```ts
const chain = dialecte
	.goToElement({ tagName: 'AA_1', id: 'aa1-001' })
	.delete({ parentTagName: 'A' })
// now focused on A, AA_1 and its descendants are staged for deletion
```

## deepCloneChild

Deep clone an entire tree record (with all descendants) as a new child under the current focus.

```ts
chain.deepCloneChild({ record: treeRecord, setFocus: false })
```

### Parameters

| Name       | Type                               | Required | Description                                                    |
| ---------- | ---------------------------------- | -------- | -------------------------------------------------------------- |
| `record`   | `TreeRecord<Config, ChildElement>` | yes      | The tree record to clone (typically obtained from `getTree()`) |
| `setFocus` | `boolean`                          | yes      | Whether to move focus to the cloned root element               |

### Returns

- `setFocus: true` → `Chain<Config, ChildElement>` — focus moves to the cloned child
- `setFocus: false` → `Chain<Config, Element>` — focus stays on the current element

### Behavior

- Walks the tree recursively, creating new elements with new UUIDs for each node.
- Supports `dialecteConfig.hooks.beforeClone` to transform or skip individual records during cloning.
- The cloned tree is fully independent from the original.

### Example

```ts
// Get a tree, then clone it under a different parent
const tree = await dialecte.goToElement({ tagName: 'AA_1', id: 'aa1-001' }).getTree()

const chain = dialecte
	.goToElement({ tagName: 'A', id: 'a-001' })
	.deepCloneChild({ record: tree, setFocus: false })
	.commit()
```

## Focus behavior summary

| Method                                | Focus after call  |
| ------------------------------------- | ----------------- |
| `addChild({ setFocus: true })`        | New child         |
| `addChild({ setFocus: false })`       | Stays on parent   |
| `update(...)`                         | Stays on current  |
| `delete(...)`                         | Moves to parent   |
| `deepCloneChild({ setFocus: true })`  | Cloned child root |
| `deepCloneChild({ setFocus: false })` | Stays on current  |
