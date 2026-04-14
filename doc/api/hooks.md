---
description: Reference for all TransactionHooks extension points in @dialecte/core. Covers beforeClone, afterStandardizedRecord, afterCreated, afterDeepClone, afterUpdated, and beforeDelete. For IO hooks, see the IO section.
---

# Hooks

Dialecte exposes two hook surfaces for extending behavior without modifying core: **Transaction hooks** (fired during mutations) and **[IO hooks](/io/hooks)** (fired during XML import).

Hooks are defined on the `dialecteConfig` object and are called automatically by the engine. Each hook returns additional `Operation[]` to stage (or `void` for read-only hooks), keeping the extension model composable.

## Transaction hooks

Registered under `dialecteConfig.hooks`. All async hooks receive `query` — a read-only `Query` instance scoped to the current transaction state. Use it to call `query.getRecord`, `query.findAncestors`, `query.getRecordsByTagName`, etc. Staged ops from earlier in the same transaction are visible.

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

Fires **per record** after `standardizeRecord` applies definition defaults. Use it to enrich newly created records before they are staged (e.g., auto-generate a required attribute for elements that need one).

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

Fires **once** after `deepClone` completes the full recursive clone. Receives the complete source→target `CloneMapping[]`. Use it to remap cross-references after the entire subtree is staged.

**Signature**

```ts
afterDeepClone?: (params: {
  mappings: CloneMapping<Config>[]
  query: Query<Config>
}) => Promise<Operation<Config>[]>
```

```ts
type CloneMapping<Config> = {
	source: Ref<Config, ElementsOf<Config>>
	target: Ref<Config, ElementsOf<Config>>
}
```

**Return** — additional operations to stage.

**Example — remap cross-references after clone**

```ts
hooks: {
  afterDeepClone: async ({ mappings, query }) => {
    const ops: Operation[] = []
    for (const { source, target } of mappings) {
      const sourceRecord = await query.getRecord(source)
      const targetRecord = await query.getRecord(target)
      // build updates based on the source→target record pairs
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
afterDeepClone         (once, after full tree staged)
```

For `update`:

```
afterUpdated
```

For `delete`:

```
beforeDelete           (once, on root — descendants still live)
[subtree cascade]
```

For `importXmlFiles` (see [IO hooks](/io/hooks)):

```
beforeImportRecord     (per record, document order)
[records stored]
afterImport            (once)
```
