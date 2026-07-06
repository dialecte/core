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

Converts attributes from object format (`{ aA: 'val' }`) to the internal array format (`[{ name: 'aA', value: 'val', namespace }]`), resolving each attribute's namespace and **canonicalizing its name** to the two naming rules (see [Attribute namespaces](#attribute-namespaces) below). Accepts either format as input.

```ts
import { toFullAttributeArray } from '@dialecte/core/helpers'

const attrs = toFullAttributeArray({
	dialecteConfig,
	tagName: 'A',
	attributes: { aA: 'hello' },
})
```

An attribute whose name carries a prefix that the config's `namespaces` cannot resolve (and that isn't given an explicit `namespace`) throws `DialecteError` (`UNKNOWN_NAMESPACE_PREFIX`).

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

Builds a complete, **canonical** `RawRecord` from a partial input — the single form every record-entry point produces (`addChild`/`deepClone`, `update`, `project.import`, `initEmptyDocument`), so records compare cleanly regardless of how they were created. It:

- assigns `crypto.randomUUID()` when no `id` is given, and normalizes attributes to array form with **canonical names** (see [Attribute namespaces](#attribute-namespaces));
- fills schema attributes in **definition-`sequence` order**, resolving each value as `provided ?? fixed ?? default` (required attributes fall back to `''`);
- drops unnamespaced attributes not in the schema; keeps namespaced/`xmlns` ones, **deterministically ordered** after the schema attributes (`orderAttributesBySequence`);
- sets the element's namespace, resolved **per parent→child context** (see [Element namespaces](#element-namespaces));
- runs the `afterStandardizedRecord` hook (if provided), then re-applies canonical ordering so hook additions stay ordered.

The per-attribute schema facts come from the shared [`getAttributeRules`](/guide/development/utils#getattributerules), which XML export reuses so the two never drift.

```ts
import { standardizeRecord } from '@dialecte/core/helpers'

const record = standardizeRecord({
	dialecteConfig,
	hooks, // optional — supplies afterStandardizedRecord
	record: { tagName: 'A', attributes: { aA: 'val' } },
})
// → canonical RawRecord<Config, 'A'> with id, namespace, ordered attributes, parent, children
```

#### Attribute namespaces

Every attribute is stored under one predictable name, whether it arrived from a parsed document, `addChild`, or `update`:

- **Default namespace → bare local name**, no `namespace` object: `aA`, `aAA_1`, `root`.
- **Any non-default namespace → `prefix:local`**, with a `namespace` object: `ext:cA`, `ext:cAA_1`, `ext:root`.

A prefixed name is used only when a namespace applies, so a non-default attribute never collides with a bare default one (e.g. `root` and `ext:root` coexist on the `Root` element). This matches the generated schema keys and XML export, so read/write by the same name regardless of how the record was produced.

To write an attribute in a namespace the config does not declare, pass the explicit form (a bare `prefix:local` with an unknown prefix throws `UNKNOWN_NAMESPACE_PREFIX`):

```ts
await tx.addChild(parent, {
	tagName: 'A',
	attributes: [
		{ name: 'note', value: 'v', namespace: { prefix: 'x', uri: 'http://example.com/x' } },
	],
})
```

#### Element namespaces

An element's namespace can depend on its **parent context**: the same local name may be declared in different namespaces under different parents. The generated definition carries this on the parent→child edge (`ChildDefinition.namespace`), and `standardizeRecord` stamps the edge namespace onto the record, falling back to the element's own namespace when the edge omits one (or the record is a root).

For example, an element declared in the default namespace under one parent but in the `ext` namespace under another serializes as bare `A` under the first parent and `ext:A` under the second — driven entirely by the definition, with no per-element special-casing.

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

| Export                            | Value                           | Description                                                             |
| --------------------------------- | ------------------------------- | ----------------------------------------------------------------------- |
| `CUSTOM_RECORD_ID_ATTRIBUTE_NAME` | `'db-id'`                       | Attribute local name for pinned record IDs                              |
| `CUSTOM_RECORD_ID_ATTRIBUTE`      | `'dev:db-id'`                   | Qualified attribute name (`prefix:local`)                               |
| `DIALECTE_DEV_NAMESPACE`          | `{ prefix: 'dev', uri: '...' }` | The `dev` XML namespace used for tool attributes                        |
| `XSI_NAMESPACE`                   | `{ prefix: 'xsi', uri: '...' }` | W3C XML Schema-instance namespace descriptor                            |
| `DIALECTE_NAMESPACES`             | `{ dev: ..., xsi: ... }`        | Grouped framework namespaces - spread into dialecte `namespaces` config |

---

## XML inspection

### `inspectXml`

Lightweight SAX-based inspector. Streams an XML string, collects the first occurrence of each requested element, then stops early. No DOM construction.

Use this in `beforeImport` hooks to detect XML dialect versions without a full parse.

```ts
import { inspectXml } from '@dialecte/core'

const report = inspectXml(xml, { elements: ['Project', 'project'] as const })
// report.Project?.attributes   → Partial<AttributesValueObject>
// report.Project?.children     → string[]
// report.Project?.value        → string (inner text)
```

**Type-safe with a config:**

```ts
import { inspectXml } from '@dialecte/core'
import { MY_DIALECTE_CONFIG } from './config'

const report = inspectXml(xml, {
	config: MY_DIALECTE_CONFIG,
	elements: ['Root'] as const,
})
// report.Root?.attributes → typed to the Root element's attribute map
```

**Params**

| Param             | Type                       | Description                                                    |
| ----------------- | -------------------------- | -------------------------------------------------------------- |
| `xml`             | `string`                   | Raw XML string to inspect                                      |
| `params.elements` | `readonly string[]`        | Element local names to search for (case-sensitive)             |
| `params.config`   | `AnyDialecteConfig` (opt.) | Dialecte config - enables typed attribute access on the report |

**Returns** A `Record<ElementName, InspectedElement | undefined>`. Keys are the requested element names; `undefined` when not found in the input.
