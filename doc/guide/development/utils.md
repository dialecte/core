---
description: Low-level utilities exported from @dialecte/core/utils — schema-derived attribute rules, canonical ordering, assertions, and file saving.
---

# Utils

Utilities exported from `@dialecte/core/utils`. These are the shared, framework-level primitives that `standardizeRecord` and XML export build on — the "single source of truth" for how attributes are classified and ordered. Most application code uses the higher-level [Helpers](/guide/development/helpers) and the Document/Query/Transaction API instead, but these are public for tooling, custom pipelines, and tests.

```ts
import {
	getAttributeRules,
	resolveSchemaAttributeValue,
	isSchemaDefaultValue,
	extractLocalName,
	resolveNamespaceByPrefix,
	resolveNamespaceByScope,
	resolvePrefixByNamespaceScope,
	compareQualifiedAttributes,
	orderAttributesBySequence,
	orderByConfigSequence,
	invariant,
	saveToDisk,
} from '@dialecte/core/utils'
```

---

## Attribute rules

### `getAttributeRules`

Returns the schema-derived facts about a single attribute of an element. This is the **single source of truth** shared by `standardizeRecord` (which builds the canonical stored form) and XML export (which shapes output) — centralizing the schema reads here keeps the two from drifting.

```ts
import { getAttributeRules } from '@dialecte/core/utils'

const rules = getAttributeRules({
	dialecteConfig,
	tagName: 'Root',
	attributeName: 'ext:root',
})
// {
//   isKnownElement: true,
//   isDefined: true,
//   isRequired: false,
//   isIdentityField: false,
//   fixed: undefined,         // an XSD `fixed` would take precedence over `default`
//   default: '2',
//   namespace: { prefix: 'ext', uri: 'http://dialecte.dev/XML/DEV-EXT' },
// }
```

Note that the `attributeName` is the **canonical** name — bare local for a default-namespace attribute (`root`, `aA`), `prefix:local` for any other (`ext:root`, `ext:cA`). See [Attribute namespaces](/guide/development/helpers#attribute-namespaces).

**`AttributeRules`**

| Field             | Type                     | Meaning                                                            |
| ----------------- | ------------------------ | ------------------------------------------------------------------ |
| `isKnownElement`  | `boolean`                | The tag is a known dialecte element with a definition              |
| `isDefined`       | `boolean`                | The attribute is declared in the element's schema                  |
| `isRequired`      | `boolean`                | The attribute is required by the schema                            |
| `isIdentityField` | `boolean`                | The attribute participates in a `key`/`unique` identity constraint |
| `fixed`           | `string \| undefined`    | XSD `fixed` value, if any (takes precedence over `default`)        |
| `default`         | `string \| undefined`    | Schema `default` value, if any                                     |
| `namespace`       | `Namespace \| undefined` | Declared namespace — absent for a default-namespace attribute      |

An unknown element or attribute returns the type with the booleans `false` and the value fields `undefined`, so callers can branch without extra guards.

### `resolveSchemaAttributeValue`

The schema value to inject for an **absent** attribute, per the requested view. Derived entirely from `getAttributeRules`, so read, export, and compare share one source of truth. The store is [faithful](/io/#schema-value-materialization) — it never fills defaults — so this resolver is what turns the stored form into an effective or export view. A stored value always wins and is handled by the caller before this is consulted.

The `defaults` mode selects the view (`AttributeDefaults = 'none' | 'optional' | 'required'`):

| `defaults`   | Returns for an absent attribute                                                   | View                   |
| ------------ | --------------------------------------------------------------------------------- | ---------------------- |
| `'none'`     | `undefined` — inject nothing                                                      | faithful / stored-only |
| `'optional'` | `fixed`, else a non-empty `default`, else `undefined`                             | read (effective) view  |
| `'required'` | for a `required` or `fixed` attribute: `fixed ?? default ?? ''`; else `undefined` | XSD / export view      |

```ts
import { resolveSchemaAttributeValue } from '@dialecte/core/utils'

// A required attribute with no schema default:
resolveSchemaAttributeValue({
	dialecteConfig,
	tagName: 'AA_1',
	attributeName: 'aAA_1',
	defaults: 'optional',
})
// → undefined  (read view does not fabricate it)
resolveSchemaAttributeValue({
	dialecteConfig,
	tagName: 'AA_1',
	attributeName: 'aAA_1',
	defaults: 'required',
})
// → ''         (export view materializes it for XSD validity)
```

This resolver backs the [`defaults` option](/api/query#schema-defaults-the-defaults-option) on `getAttribute` / `getAttributes` (read, default `'optional'`) and the export serializer (`'required'`).

### `isSchemaDefaultValue`

Whether a value equals the attribute's schema default, for **compare**: matches the `fixed` value if any, else the `default` (an empty-string default included). Compare sites drop attributes for which this is true, so an authored default-equal value and an absent attribute fold to the same thing.

```ts
import { isSchemaDefaultValue } from '@dialecte/core/utils'

isSchemaDefaultValue({ dialecteConfig, tagName: 'BBB_1', attributeName: 'bBBB_1', value: 'false' })
// → true   ('false' is the schema default)
isSchemaDefaultValue({ dialecteConfig, tagName: 'BBB_1', attributeName: 'bBBB_1', value: 'true' })
// → false
```

### `extractLocalName`

Strips a namespace prefix from an attribute (or element) name, returning the local part.

```ts
import { extractLocalName } from '@dialecte/core/utils'

extractLocalName('ext:cAA_1') // 'cAA_1'
extractLocalName('ext:root') // 'root'
extractLocalName('aA') // 'aA'
```

### `resolveNamespaceByPrefix`

Looks up a namespace declared in the config by its prefix. Returns `undefined` for an empty or unknown prefix — consumers cannot extend `config.namespaces`, so an unknown prefix is a caller error (see `UNKNOWN_NAMESPACE_PREFIX` in [State & Errors](/guide/development/state-and-errors#error-catalog)).

```ts
import { resolveNamespaceByPrefix } from '@dialecte/core/utils'

resolveNamespaceByPrefix(dialecteConfig, 'ext')
// → { prefix: 'ext', uri: 'http://dialecte.dev/XML/DEV-EXT' }
resolveNamespaceByPrefix(dialecteConfig, 'unknown')
// → undefined
```

### `resolveNamespaceByScope`

Resolves a namespace **scope** string to its full `Namespace`. A scope is normally a `config.namespaces` **key** (e.g. `ext`); as a fallback it is matched against declared prefixes. This is what lets an authored attribute's `namespace` be a scope string instead of a `{ prefix, uri }` object.

```ts
import { resolveNamespaceByScope } from '@dialecte/core/utils'

resolveNamespaceByScope(dialecteConfig, 'ext')
// → { prefix: 'ext', uri: 'http://dialecte.dev/XML/DEV-EXT' }
```

### `resolvePrefixByNamespaceScope`

Resolves a namespace scope string to its XML **prefix**. A config key maps to its declared prefix; an unknown string is treated as a raw prefix, so callers can target custom namespaces. Backs the `namespace` scoping on `getAttribute` / `getAttributes`.

```ts
import { resolvePrefixByNamespaceScope } from '@dialecte/core/utils'

resolvePrefixByNamespaceScope(dialecteConfig, 'ext') // → 'ext'
```

### `compareQualifiedAttributes`

A stable comparator for attributes that fall outside an element's schema `sequence` (namespaced extras and `xmlns` declarations). Sorts by namespace URI, then name — so two records carrying the same attribute set compare equal regardless of parse/clone/update order.

```ts
import { compareQualifiedAttributes } from '@dialecte/core/utils'

attributes.sort(compareQualifiedAttributes)
```

### `orderAttributesBySequence`

Puts an element's attributes into canonical order: schema-`sequence` attributes first (in sequence order), then everything else sorted deterministically via `compareQualifiedAttributes`. Never drops attributes — reorders only — so it is safe to re-apply after an `afterStandardizedRecord` hook that added or moved attributes.

```ts
import { orderAttributesBySequence } from '@dialecte/core/utils'

const ordered = orderAttributesBySequence(record.attributes, definition.attributes.sequence)
```

---

## Child ordering

### `orderByConfigSequence`

Orders a parent's child nodes by the config-declared child `sequence`. Generic over node type (anything with a `tagName`), so the same logic serves XML building and `TreeRecord` post-processing. Children whose tag is not in the sequence are appended last (relative order preserved); a parent with no declared sequence returns its input unchanged. Pure — no side effects.

```ts
import { orderByConfigSequence } from '@dialecte/core/utils'

const ordered = orderByConfigSequence({
	parentTagName: 'Root',
	children, // e.g. [{ tagName: 'C' }, { tagName: 'A' }, { tagName: 'B' }]
	childrenConfig: dialecteConfig.children,
})
// → reordered to the parent's declared sequence, e.g. ['A', 'B', 'C']
```

---

## Assertions

### `invariant`

Guard that throws a structured `DialecteError` when a condition is falsy, narrowing the value for TypeScript (`asserts condition`). Documented in full — with `throwDialecteError` and the error catalog — under [State & Errors](/guide/development/state-and-errors#invariant).

```ts
import { invariant } from '@dialecte/core/utils'

invariant(record, { detail: `record ${ref.tagName}#${ref.id} not found` })
// record is non-nullable below
```

---

## Browser

### `saveToDisk`

Saves a `Blob` to disk using the native File System Access API when available (Chrome/Edge) and falling back to a hidden-anchor download (Safari/Firefox). Browser-only — relies on `window`/`document`/`URL`. Used by `project.export`.

```ts
import { saveToDisk } from '@dialecte/core/utils'

await saveToDisk({
	data: new Blob([xmlString], { type: 'application/xml' }),
	filename: 'export.xml',
	pickerType: { description: 'XML file', accept: { 'application/xml': ['.xml'] } },
})
```

A cancelled save-file picker (`AbortError`) resolves silently.
