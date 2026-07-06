---
description: Reference for all DialecteHooks extension points in @dialecte/core. Covers the record hooks (beforeClone, afterStandardizedRecord, afterCreated, afterDeepClone, afterUpdated, beforeDelete) and links to the IO hooks. All hooks are provided on the Project instance.
---

# Hooks

Dialecte exposes lifecycle hooks for extending behavior without modifying core: **record hooks** (fired during mutations) and **[IO hooks](/io/hooks)** (fired during XML import). Because standardization now runs on both paths, they are provided together as one flat `DialecteHooks` object — **on the `Project` instance, not on the config**:

```ts
export type DialecteHooks<Config> = IOHooks & TransactionHooks<Config>

const project = await new Project({ configs, storage, hooks }).open(name)
```

Providing hooks on the instance keeps them fully typed against the dialecte's concrete config (no cast). Each hook returns additional `Operation[]` to stage (or `void` for read-only hooks), keeping the extension model composable.

## Transaction hooks

Provided via `new Project({ hooks })` (see [Project](/api/project)). All async hooks receive `query` — a read-only `Query` instance scoped to the current transaction state. Use it to call `query.getRecord`, `query.findAncestors`, `query.getRecordsByTagName`, etc. Staged ops from earlier in the same transaction are visible.

### `beforeClone`

Fires **per record** before it is inserted into the clone tree. Use it to suppress or transform records during `deepClone`.

**Signature**

```ts
beforeClone?: (params: {
  record: TreeRecord<Config, Element>
}) => { shouldBeCloned: boolean; transformedRecord: TreeRecord<Config, Element> }
```

**Return** — `shouldBeCloned: false` drops the record and its entire subtree from the clone. `transformedRecord` applies attribute or value changes to the cloned copy without mutating the source.

**Example — strip an attribute on clone**

```ts
hooks: {
  beforeClone: ({ record }) => ({
    shouldBeCloned: true,
    transformedRecord: {
      ...record,
      attributes: record.attributes.filter((a) => a.name !== 'internal-id'),
    },
  }),
}
```

---

### `afterStandardizedRecord`

Fires **per record** wherever `standardizeRecord` runs — which is now every record entry point: `addChild`/`deepClone`, **`update`**, **`project.import`** (per parsed element), and **`initEmptyDocument`** (the root). Use it to enrich a record after core applies definition defaults (e.g., auto-generate a required attribute such as a `uuid`).

Because it fires at every entry point, keep it **idempotent** — running it again on an already-enriched record must be a no-op (e.g. only fill a `uuid` when missing, never regenerate). Core **re-applies canonical attribute ordering after the hook**, so a hook may append or move attributes and the stored record stays order-canonical.

**Signature**

```ts
afterStandardizedRecord?: (params: {
  record: RawRecord<Config, Element>
}) => RawRecord<Config, Element>
```

**Return** — the enriched record. Must return the same element type.

---

### `afterCreated`

Fires **per record** after it is staged via `addChild` (including inside `deepClone`). Use it to stage additional operations alongside the new element (e.g., wrap it in a container, or set dependent attributes on existing records).

**Signature**

```ts
afterCreated?: (params: {
  childRecord: RawRecord<Config, Element>
  parentRecord: RawRecord<Config, ParentElement>
  query: Query<Config>
}) => Promise<Operation<Config>[]>
```

**Return** — additional operations to stage. Return `[]` to add nothing.

::: warning Ordering inside `deepClone`
During `deepClone`, `afterCreated` fires in insertion order. Elements staged earlier in the same pass are visible via `getRecord`; elements staged later are not. Use `afterDeepClone` as a safety net for cross-element dependencies within a single clone operation.
:::

---

### `afterDeepClone`

Fires **once** after `deepClone` completes the full recursive clone. Receives `cumulativeCloneMappings` -- the complete source->target mappings accumulated across all `deepClone` calls within the current transaction. Use it to remap cross-references after the entire subtree is staged.

**Signature**

```ts
afterDeepClone?: (params: {
  cumulativeCloneMappings: CloneMapping<Config>[]
  query: Query<Config>
}) => Promise<Operation<Config>[]>
```

```ts
type CloneMapping<Config> = {
	source: Ref<Config, ElementsOf<Config>> & {
		attributes: readonly AnyAttribute[]
	}
	target: Ref<Config, ElementsOf<Config>>
}
```

`source` carries the original record's attributes so hooks can recover source-side data without querying across databases.

**Return** -- additional operations to stage.

**Example -- remap cross-references after clone**

```ts
hooks: {
  afterDeepClone: async ({ cumulativeCloneMappings, query }) => {
    const ops: Operation[] = []
    for (const { source, target } of cumulativeCloneMappings) {
      const targetRecord = await query.getRecord(target)
      // source.attributes available for cross-DB lookup
      // build updates based on the source->target record pairs
    }
    return ops
  },
}
```

---

### `afterUpdated`

Fires **per update** after the updated record is staged. Receives both the old and new record. Use it to propagate side-effects of attribute changes (e.g., when a record is renamed, recalculate cross-references that point to it by name).

**Signature**

```ts
afterUpdated?: (params: {
  oldRecord: RawRecord<Config, Element>
  newRecord: RawRecord<Config, Element>
  query: Query<Config>
}) => Promise<Operation<Config>[]>
```

**Return** — additional operations to stage.

---

### `beforeDelete`

Fires **once per deletion root** before the subtree is cascaded. Root and all descendants are **still live in `query`** at this point.

The hook receives only the deletion root — not each descendant individually. Use `findDescendants(record)` to collect the full set of elements about to be removed.

**Signature**

```ts
beforeDelete?: (params: {
  record: RawRecord<Config, Element>
  query: Query<Config>
}) => Promise<Operation<Config>[]>
```

**Return** — additional operations to stage (e.g., clear or delete elements that reference the deleted subtree).

::: tip Subtree coverage
The hook fires once on the root. Call `findDescendants(record)` inside to get the full set of elements being removed — this is more efficient than per-descendant calls because it allows one shared scan over all affected UUIDs before updating referencing elements.
:::

---

## IO hooks

IO hooks (`beforeImportRecord`, `afterImport`) are documented on the [IO hooks](/io/hooks) page.

---

## Hook firing order

For a single `addChild` call:

```
afterStandardizedRecord → afterCreated
```

For a single `deepClone` call (N elements in the tree):

```
beforeClone            (per element, depth-first)
afterStandardizedRecord (per element)
afterCreated           (per element, insertion order)
afterDeepClone         (once, after full tree staged -- receives cumulativeCloneMappings)
```

For `update` (the merged record is re-standardized, so the hook fires here too):

```
afterStandardizedRecord → afterUpdated
```

A `update` whose canonical result is identical to the stored record is a **no-op**: it stages nothing and `afterUpdated` does not fire.

For `delete`:

```
beforeDelete           (once, on root — descendants still live)
[subtree cascade]
```

For `project.import` (see [IO hooks](/io/hooks)) — standardization runs **before** `beforeImportRecord`, so that hook receives the finalized, canonical record:

```
beforeImport            (once, whole XML string)
afterStandardizedRecord (per record, as each element closes)
beforeImportRecord      (per record, document order)
[records stored]
afterImport             (once)
```

For `initEmptyDocument`:

```
afterStandardizedRecord (once, on the root)
```
