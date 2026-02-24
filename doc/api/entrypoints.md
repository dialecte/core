# Entrypoints

Once you have a `dialecte` instance (see [API Overview](/api/)), you start every interaction by anchoring a chain to an element. There are two entrypoints:

## dialecte.fromRoot()

Starts a chain anchored to the root element. Asserts that exactly one root element exists in the database.

```ts
const results = await dialecte.fromRoot().findDescendants({ tagName: 'AA_1' })
```

Returns `Chain<Config, RootElement, Extensions>`.

## dialecte.fromElement()

Starts a chain anchored to a specific element by tag name and — for non-singleton elements — a required `id`.

```ts
// Singleton element — id is optional
const ctx = await dialecte.fromElement({ tagName: 'A' }).getContext()

// Non-singleton — id is required
const ctx = await dialecte.fromElement({ tagName: 'AA_1', id: knownId }).getContext()
```

| Parameter | Type                 | Description                                                  |
| --------- | -------------------- | ------------------------------------------------------------ |
| `tagName` | `ElementsOf<Config>` | Tag name of the element to focus                             |
| `id`      | `string`             | Required for non-singleton elements; optional for singletons |

Returns `Chain<Config, Element, Extensions>`.

> **Singleton elements** are listed in `dialecteConfig.singletonElements`. For those, `fromElement` can locate the element by tag name alone — no `id` needed.

## What's next

Both entrypoints return a `Chain`. From there you can:

- **Navigate** — `goToElement`, `goToParent` → [Navigation](/api/chain/navigation)
- **Query** — `findDescendants`, `getContext`, `getTree` → [Queries](/api/chain/queries)
- **Mutate** — `addChild`, then `.commit()` → [Mutations](/api/chain/mutations)
