# Writing Extensions

Extensions inject domain-specific methods directly into the chain, typed to the elements that support them. Once registered, they are indistinguishable from built-in methods.

## How it works

An extension is a function that:

1. Receives **chain internals** via `ExtensionsMethodParams`
2. Returns the **actual method** — the function the caller will invoke

`ExtensionsMethodParams` carries three values:

| Field            | Type               | Description                                              |
| ---------------- | ------------------ | -------------------------------------------------------- |
| `chain`          | `ChainFactory`     | Factory to create a new chain from a context — see below |
| `dialecteConfig` | `GenericConfig`    | The full dialecte config                                 |
| `contextPromise` | `Promise<Context>` | Resolves to the current focus and staged operations      |

## Registering extensions

Extensions are grouped by element in an `ExtensionRegistry` object. Pass it to `createDialecte`:

```ts
import { createDialecte, TEST_DIALECTE_CONFIG } from '@dialecte/core'

const MY_EXTENSIONS = {
	A: { summarize },
	AA_1: { describe },
}

const dialecte = await createDialecte({
	databaseName,
	dialecteConfig: TEST_DIALECTE_CONFIG,
	extensions: MY_EXTENSIONS,
})

// Available only when the chain is focused on 'A'
const summary = await dialecte.fromElement({ tagName: 'A' }).summarize()
```

The TypeScript compiler infers which methods are available based on the focused element — calling `summarize()` on a chain focused on `AA_1` is a type error.

## Two method types

Extension methods come in two shapes depending on what they return.

### Ending methods

An ending method returns a **value** — data, an object, a boolean. The caller awaits it directly.

```ts
// Returns data — caller awaits it
function summarize(params: ExtensionsMethodParams<Config, 'A'>) {
	const { contextPromise } = params

	return async function () {
		const context = await contextPromise
		return {
			id: context.currentFocus.id,
			attributes: context.currentFocus.attributes,
		}
	}
}

const data = await dialecte.fromElement({ tagName: 'A' }).summarize()
```

Because the method is `async`, it returns a `Promise`. The chain ends here — nothing can be dot-chained after it.

---

### Chain methods

A chain method returns **a chain**, so the caller can keep dot-chaining.

Wrap the work inside `contextPromise.then(...)` and return `chain({ contextPromise: newContextPromise })` **synchronously**. The caller receives a `Chain` immediately — not a Promise — so dot-chaining works naturally:

```ts
function addStandardBranch(params: ExtensionsMethodParams<Config, 'A'>) {
	const { chain, contextPromise } = params

	return function (p: { label: string }) {
		const newContextPromise = contextPromise.then(async (context) => {
			const sourceChain = chain({ contextPromise: Promise.resolve(context) })

			const endingChain = sourceChain
				.addChild({
					tagName: 'AA_1',
					attributes: { aAA_1: p.label },
					setFocus: true,
				})
				.addChild({
					tagName: 'AAA_1',
					attributes: { aAAA_1: 'default' },
					setFocus: false,
				})
				.goToElement({ tagName: 'A' })

			// Return a Context — this becomes the resolved value of newContextPromise
			return await endingChain.getContext()
		})

		// Return a chain synchronously — the work above is deferred
		return chain({ contextPromise: newContextPromise })
	}
}

// ✅ Fluent dot-chaining works — nothing executes until .commit()
await dialecte.fromElement({ tagName: 'A' }).addStandardBranch({ label: 'section-1' }).commit()
```

**Why this keeps the chain lazy:**

The inner `.then` callback only runs when something awaits `newContextPromise` — which happens when the terminal method (`.commit()`, `.getContext()`, etc.) is finally called. All prior mutations are preserved because `context` captured them at that point.
