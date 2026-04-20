---
description: Type guards, record converters, and utility helpers exported from @dialecte/core/helpers.
---

# Helpers

Utility functions exported from `@dialecte/core/helpers`. All are pure, zero-overhead TypeScript helpers — no async, no side effects.

---

## Type guards

### `isRecordOf`

Narrows a record to a specific element tag name. Works on `RawRecord`, `TrackedRecord`, and `TreeRecord`.

```ts
import { isRecordOf } from '@dialecte/core/helpers'

if (isRecordOf(record, 'A')) {
	record // TrackedRecord<Config, 'A'>
}
```

### `isAttributeOf`

Narrows a runtime `string` to a typed `AttributesOf<Config, Element>` by checking the attribute exists on the record. Enables `query.getAttribute` without a cast.

```ts
import { isAttributeOf } from '@dialecte/core/helpers'

if (isAttributeOf(record, name)) {
	await query.getAttribute(record, name) // fully typed
}
```

### `isElementOf`

Narrows a runtime `string` to `ElementsOf<Config>` by checking the tag name is a known element in the config. Enables `query.getRecordsByTagName` without a cast.

```ts
import { isElementOf } from '@dialecte/core/helpers'

if (isElementOf(tagName, dialecteConfig)) {
	await query.getRecordsByTagName(tagName) // fully typed
}
```

### `isChildOf` / `isParentOf`

Narrow a relationship (`children[]` / `parent`) to a specific tag name.

```ts
import { isChildOf, isParentOf } from '@dialecte/core/helpers'

const aa1Refs = record.children.filter((child) => isChildOf(child, 'AA_1'))
// aa1Refs: (AnyRelationship & { tagName: 'AA_1' })[]

if (record.parent && isParentOf(record.parent, 'A')) {
	record.parent // AnyRelationship & { tagName: 'A' }
}
```

### `isRawRecord` / `isTrackedRecord` / `isTreeRecord`

Discriminate between the three record variants by checking their exact key sets.

```ts
import { isTrackedRecord } from '@dialecte/core/helpers'

if (isTrackedRecord(record)) {
	record.status // 'unchanged' | 'created' | 'updated' | 'deleted'
}
```

### `isFullAttributeArray`

Discriminates between attribute object format (`{ name: value }`) and array format (`FullAttributeObject[]`).

```ts
import { isFullAttributeArray } from '@dialecte/core/helpers'

if (isFullAttributeArray(attributes)) {
	attributes // FullAttributeObject[]
}
```

---

## Converters

### `toRawRecord`

Strips `status` (and `tree`) from any record variant to produce a `RawRecord`. Safe to pass any variant.

```ts
import { toRawRecord } from '@dialecte/core/helpers'

const raw = toRawRecord(trackedRecord) // RawRecord<Config, Element>
```

### `toTrackedRecord`

Promotes any record variant to a `TrackedRecord`. Preserves the existing `status` unless overridden.

```ts
import { toTrackedRecord } from '@dialecte/core/helpers'

const tracked = toTrackedRecord({ record, status: 'updated' })
```

### `toTreeRecord`

Promotes any record variant to a `TreeRecord`. Preserves existing `tree` unless overridden.

```ts
import { toTreeRecord } from '@dialecte/core/helpers'

const tree = toTreeRecord({ record, tree: childTrees })
```

### `toRef`

Extracts a `Ref` (`{ tagName, id }`) from any record variant, relationship, or ref. Throws if `undefined`.

```ts
import { toRef } from '@dialecte/core/helpers'

const ref = toRef(record) // Ref<Config, Element>
const ref = toRef(childRelationship)
```

### `toFullAttributeArray`

Converts attributes from object format (`{ aA: 'val' }`) to the internal array format (`[{ name: 'aA', value: 'val', namespace }]`). No-op if already an array.

```ts
import { toFullAttributeArray } from '@dialecte/core/helpers'

const attrs = toFullAttributeArray({
	dialecteConfig,
	tagName: 'A',
	attributes: { aA: 'hello' },
})
```

### `stripAttributes`

Returns a new record with specified attribute names removed. Preserves the record variant (`RawRecord`, `TrackedRecord`, or `TreeRecord`). When given a `TreeRecord`, strips recursively across the entire subtree. Pure — does not mutate the input.

```ts
import { stripAttributes } from '@dialecte/core/helpers'

const clean = stripAttributes(record, ['aA_1', 'aA_2'])
// → same variant as input, attributes filtered
```

---

## Record factory

### `standardizeRecord`

Builds a complete `RawRecord` from a partial input. Assigns `crypto.randomUUID()` when no `id` is provided. Normalizes attributes to array format.

```ts
import { standardizeRecord } from '@dialecte/core/helpers'

const record = standardizeRecord({
	dialecteConfig,
	record: { tagName: 'A', attributes: { aA: 'val' } },
})
// → RawRecord<Config, 'A'> with id, namespace, parent, children filled
```

---

## Extension registry

### `mergeExtensions`

Merges `base` and `custom` extension module sets into the flat `{ query, transaction }` registry expected by `openDialecteDocument`. Throws `DialecteError` (`EXTENSION_METHOD_COLLISION`) if the same function name appears in both groups for the same module key.

```ts
import { mergeExtensions } from '@dialecte/core/helpers'

const extensions = mergeExtensions({
	base: { history, dataModel },
	custom: { myFeature },
})
```

See [Writing Extensions](/guide/extensions/) for the full authoring guide.

---

## Constants

| Export                            | Value                           | Description                                      |
| --------------------------------- | ------------------------------- | ------------------------------------------------ |
| `CUSTOM_RECORD_ID_ATTRIBUTE_NAME` | `'db-id'`                       | Attribute local name for pinned record IDs       |
| `CUSTOM_RECORD_ID_ATTRIBUTE`      | `'dev:db-id'`                   | Qualified attribute name (`prefix:local`)        |
| `DIALECTE_DEV_NAMESPACE`          | `{ prefix: 'dev', uri: '...' }` | The `dev` XML namespace used for tool attributes |
