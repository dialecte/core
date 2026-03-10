# Writing Extensions

Extensions add domain-specific methods by subclassing `Query` and `Transaction`. Once wired into a `Document` subclass, they appear as first-class methods — fully typed against your element set.

## How it works

A dialecte package extends the core classes:

1. **`Query` subclass** — domain-specific read methods
2. **`Transaction` subclass** — domain-specific write methods
3. **`Document` subclass** — overrides `createQuery()` and `createTransaction()` to return your subclasses

## Query extensions

Extend `Query` to add domain-specific reads. Your subclass has access to `this.context` and all protected methods.

```ts
import { Query } from '@dialecte/core'
import type { RefOrRecord } from '@dialecte/core'

class SclQuery extends Query<SclConfig> {
	async getSubstations() {
		return this.getRecordsByTagName('Substation')
	}

	async getVoltageLevels(ref: RefOrRecord<SclConfig, 'Substation'>) {
		const results = await this.findDescendants(ref, { tagName: 'VoltageLevel' })
		return results.VoltageLevel
	}

	async getBaysByName(ref: RefOrRecord<SclConfig, 'VoltageLevel'>, name: string) {
		return this.findByAttributes({
			tagName: 'Bay',
			attributes: { name },
		})
	}
}
```

## Transaction extensions

Extend `Transaction` to add domain-specific writes. Since `Transaction` extends `Query`, your transaction subclass has access to both query and mutation methods.

```ts
import { Transaction } from '@dialecte/core'

class SclTransaction extends Transaction<SclConfig> {
	async createBay(
		vlRef: RefOrRecord<SclConfig, 'VoltageLevel'>,
		params: { name: string; desc?: string },
	) {
		return this.addChild(vlRef, {
			tagName: 'Bay',
			attributes: params,
		})
	}

	async moveBay(
		bayRef: RefOrRecord<SclConfig, 'Bay'>,
		targetVlRef: RefOrRecord<SclConfig, 'VoltageLevel'>,
	) {
		const tree = await this.getTree(bayRef)
		if (!tree) return

		await this.delete(bayRef)
		return this.deepClone(targetVlRef, tree)
	}
}
```

## Wiring into Document

Override `createQuery()` and `createTransaction()` in a `Document` subclass:

```ts
import { Document } from '@dialecte/core'

class SclDocument extends Document<SclConfig> {
	protected override createQuery() {
		return new SclQuery(this.store, this.config)
	}

	protected override createTransaction() {
		return new SclTransaction(this.store, this.config, this.state)
	}
}
```

Now `doc.query` returns an `SclQuery` and `doc.transaction()` provides an `SclTransaction`:

```ts
const doc = new SclDocument(store, config)

// Domain query
const substations = await doc.query.getSubstations()

// Domain transaction
await doc.transaction(async (tx) => {
	await tx.createBay(vlRef, { name: 'Bay1' })
})
```

## Type safety

TypeScript enforces the full hierarchy:

- `addChild` only accepts tag names that are valid children of the parent element
- Attribute objects are narrowed to the specific element's attributes
- `RefOrRecord` accepts refs, records, and relationships — no need for manual conversions

Invalid operations are caught at compile time, not runtime.

## Hooks — lifecycle control

Hooks run at import and export. A `beforeImportRecord` hook can auto-assign identifiers or validate structure before an element reaches the database:

```ts
beforeImportRecord(record) {
	ensureUuid(record)
	return record
}
```

This keeps domain invariants enforced at the pipeline level rather than scattered across application code.
