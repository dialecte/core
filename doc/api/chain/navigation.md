# Navigation

Navigation methods move the chain's **focus** to a different element. They return a new `Chain` typed to the target element, enabling full type-safe traversal of the document tree.

## goToElement

Navigate to any element by `tagName` and `id`.

```ts
chain.goToElement({ tagName: 'MyElement', id: 'some-uuid' })
```

### Parameters

| Name      | Type                 | Required    | Description                                                         |
| --------- | -------------------- | ----------- | ------------------------------------------------------------------- |
| `tagName` | `ElementsOf<Config>` | yes         | Tag name of the target element                                      |
| `id`      | `string`             | conditional | Element ID. **Optional for singleton elements**, required otherwise |

### Returns

`Chain<Config, TargetElement>` — focus moves to the target element.

### Behavior

- Looks up the element first in **staged operations** (supports navigating to not-yet-committed elements), then falls back to the database.
- Throws if the element is not found.
- Throws if a non-singleton element omits `id`.

### Example

```ts
// Navigate to a specific element
const chain = dialecte.goToElement({ tagName: 'AA_1', id: 'aa1-001' })

// Navigate to a singleton (id optional)
const chain = dialecte.goToElement({ tagName: 'A' })
```

## goToParent

Navigate up to the parent element.

```ts
chain.goToParent('ParentTagName')
```

### Parameters

The parameter is the parent's tag name as a string literal.

| Name            | Type                         | Required | Description                    |
| --------------- | ---------------------------- | -------- | ------------------------------ |
| `parentTagName` | `ParentsOf<Config, Element>` | yes      | Tag name of the parent element |

### Returns

`Chain<Config, ParentElement>` — focus moves to the parent.

### Constraints

- **Not available on root elements** — typed as `never` on the root element, and `undefined` at runtime.
- The parent tag name must match the actual parent of the currently focused element.

### Example

```ts
// Navigate up one level
const chain = dialecte.goToElement({ tagName: 'AA_1', id: 'aa1-001' }).goToParent('A')

// Navigate up multiple levels
const chain = dialecte
	.goToElement({ tagName: 'AAA_1', id: 'aaa1-001' })
	.goToParent('AA_1')
	.goToParent('A')
```

## Focus behavior summary

| Method             | Focus after call |
| ------------------ | ---------------- |
| `goToElement(...)` | Target element   |
| `goToParent(...)`  | Parent element   |
