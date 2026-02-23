# Endings

Ending methods are terminal operations that either retrieve context or persist changes. They return a `Promise` and **break the chain**.

## commit

Persist all staged operations to the database in a single atomic transaction.

```ts
await chain.commit()
```

### Parameters

None.

### Returns

`Promise<void>`

### Behavior

Before writing, staged operations are **merged and optimized**:

| Sequence              | Result                       |
| --------------------- | ---------------------------- |
| `created` → `updated` | `created` (with latest data) |
| `created` → `deleted` | no-op (removed entirely)     |
| `updated` → `updated` | `updated` (with latest data) |
| `updated` → `deleted` | `deleted`                    |

The merged operations are then applied atomically in a Dexie transaction using `bulkAdd`, `bulkPut`, and `bulkDelete`. Staged operations are cleared on success.

### Example

```ts
await dialecte
	.goToElement({ tagName: 'A', id: 'a-001' })
	.addChild({
		tagName: 'AA_1',
		attributes: { aAA_1: 'v1' },
		setFocus: true,
	})
	.addChild({
		tagName: 'AAA_1',
		attributes: { aAAA_1: 'v2' },
	})
	.commit()
// Both AA_1 and AAA_1 are persisted in one transaction
```

## getContext

Retrieve a snapshot of the internal chain context.

```ts
const ctx = await chain.getContext()
```

### Parameters

None.

### Returns

`Promise<Context<Config, Element>>` — a `structuredClone` of the internal context, including:

- `currentFocus` — the currently focused record
- `stagedOperations` — all pending operations

### Example

```ts
const ctx = await dialecte
	.goToElement({ tagName: 'AA_1', id: 'aa1-001' })
	.update({ attributes: { aAA_1: 'renamed' } })
	.getContext()

ctx.currentFocus.tagName // 'AA_1'
ctx.stagedOperations // [{ type: 'updated', ... }]
```

## getParent

Retrieve the full parent record of the currently focused element.

```ts
const parent = await chain.getParent()
```

### Parameters

None.

### Returns

`Promise<ChainRecord<Config, ParentsOf<Config, Element>>>` — the parent record.

### Behavior

- Checks staged operations first, then falls back to the database.
- Throws if the current element has no parent (root element).

### Example

```ts
const parent = await dialecte.goToElement({ tagName: 'AA_1', id: 'aa1-001' }).getParent()

parent.tagName // 'A'
parent.id // 'a-001'
```
