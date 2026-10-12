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
	formatXml,
	formatEmbeddedXml,
} from '@dialecte/core/utils'
```

---

## Attribute rules

### `getAttributeRules`

Returns the schema-derived facts about a single attribute of an element. This is the **single source of truth** shared by `standardizeRecord` (which builds the canonical stored form) and XML export (which shapes output) — centralizing the schema reads here keeps the two from drifting.

The element is passed as `record` - any record variant: raw, tracked or tree. A record always knows its parent (`null` for the root), and the rules are those of the element **as declared under that parent**; see [`resolveDefinition`](#resolvedefinition) for why that can differ from one parent to another. A ref is refused by the compiler: it carries no parent. Fetch its record first, or use `query.getDefinition(ref)`.

```ts
import { getAttributeRules } from '@dialecte/core/utils'

const rules = getAttributeRules({
	dialecteConfig,
	record: root, // the Root record
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

### `resolveDefinition`

A schema may declare one tag several ways - with different content under different parents, or in different namespaces. Suppose the test schema declared `AAA_1` twice: under `AA_1` with a required `aAAA_1` and its `AAAA_*` children, under `AA_2` as a bare text with no attribute. The generated definition keeps the **union** at the tag level (`DEFINITION.AAA_1`), lenient where the two differ, and each declaration under its number (`DEFINITION.AAA_1.declarations['1']`, `['2']`). A parent says which one it holds, per namespace: `DEFINITION.AA_2.children.details.AAA_1.declarations` is `{ '<uri>': ['2'] }`. `resolveDefinition` is the one rule every reader of the definition follows:

```ts
import { resolveDefinition } from '@dialecte/core/utils'

resolveDefinition({ dialecteConfig, record: aaa1UnderAa2 }) // an AAA_1 whose parent is an AA_2
// → declaration 2: no attribute, a text
resolveDefinition({ dialecteConfig, record: aaa1UnderAa1 }) // an AAA_1 whose parent is an AA_1
// → declaration 1: `aAAA_1` required, the `AAAA_*` children
resolveDefinition({ dialecteConfig, record: root }) // parent: null
// → the global declaration of the record's namespace
```

A record without a namespace yet (created) takes the only namespace its parent holds it in. A parent whose wildcard admits the record gives the global declaration of its namespace; a parent that leaves the choice to the particle the record matches gives the tag level. The parent is read at its own tag level, unless the caller passes its resolved definition (`parentDefinition`) - a top-down walk does, and decides the rare tags whose parent is itself declared several ways. The identity constraints, `nillable` and the `variants` are the declaration's: the union carries them only where every declaration agrees.

Then `xsi:type`: when the record names a type its declaration lists in `variants` - any declaration of the tag, where the parent leaves the declaration open - the attributes, children, content model and text are the type's (`dialecteConfig.types`, the `TYPES` the generator writes beside `DEFINITION`); the identity fields and constraints stay the element's. Naming the declared type itself (`type`) gives the declaration as it is. A tag declared one way, without `xsi:type`, resolves to its tag level itself; anything else is built once and returned as the same object afterwards.

### `xsi:type` values

A document writes an `xsi:type` value as a qualified name - `Block`, `plc:Block`, `abc:Block` may all name the same type. Core stores one form of it, on import and on every write (`addChild`, `update`, a hook's change): the local name for a type in the dialecte's default namespace, the dialecte's prefix and the local name for a type in another namespace it declares.

| Document or author writes                                     | Stored        |
| ------------------------------------------------------------- | ------------- |
| `Block`, `p:Block` (`p` bound to the default namespace)       | `Block`       |
| `e:tSquare` (`e` bound to the ext namespace), `{uri}tSquare`  | `ext:tSquare` |
| `q:Block` (`q` bound nowhere), a namespace the dialecte lacks | as written    |

Import reads the prefix with the namespaces in scope at the element, an ancestor's bindings included. The value keeps what XML says it means, whoever writes it - a file or code: an unprefixed name is in the default namespace, so `tTriangle` where only `ext:tTriangle` exists stays `tTriangle` and validation reports it. Export declares the prefix the value uses, and when an element in another namespace re-binds it where the value stands, writes the value with a prefix bound to its namespace there.

```ts
import { admittedXsiTypes, canonicalXsiType, resolveXsiType } from '@dialecte/core/utils'

resolveXsiType({ dialecteConfig, record }) // { clark: '{uri}tSquare', namespace: 'uri', local: 'tSquare' }
admittedXsiTypes({ dialecteConfig, record }) // the Clark names it may name: its declared type (unless abstract), its variants
```

Filters (`findByAttributes`, `findDescendants`, `getTree` `where`, `omit`, `ensureChild`) compare `xsi:type` as the type it names: `{ 'xsi:type': 'tSquare' }`, `{ 'xsi:type': 'ext:tSquare' }` and the Clark name each find what they name, a record stored by an earlier core with the document's own prefix included.

It takes a record because the record carries its parent. A ref does not, and passing one would silently read the union, so the compiler refuses it: `query.getDefinition(ref)` fetches the record first (staged → cache → store) and resolves from it.

The same rule holds at the type level, additively: `AttributesValueObjectOf<Config, 'AAA_1'>` is the tag-level object exactly as before, and `AttributesValueObjectOf<Config, 'AAA_1', 'AA_2'>` - a parent named - is the object declared under `AA_2`, read from `ATTRIBUTES.byParent`, the second axis of the one attributes constant a dialecte generates (`byTag` is the table every consumer had; both are skeletons - one key per attribute name, typed - and what an attribute is lives in `DEFINITION`). `addChild` and `ensureChild` already know the parent, so `tx.addChild(aa2, { tagName: 'AAA_1', attributes: { aAAA_1: 'x' } })` is refused by the compiler. A dialecte package exposes the same through its namespace: `<Name>.AttributesOf<'AAA_1', 'AA_2'>`.

### `resolveSchemaAttributeValue`

The schema value to inject for an **absent** attribute, per the requested view. Derived entirely from `getAttributeRules`, so read, export, and compare share one source of truth. The store is [faithful](/io/#schema-value-materialization) — it never fills defaults — so this resolver is what turns the stored form into an effective or export view. A stored value always wins and is handled by the caller before this is consulted. It takes the same `record` as [`getAttributeRules`](#getattributerules).

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
	record: aa1, // an AA_1 record
	attributeName: 'aAA_1',
	defaults: 'optional',
})
// → undefined  (read view does not fabricate it)
resolveSchemaAttributeValue({
	dialecteConfig,
	record: aa1, // an AA_1 record
	attributeName: 'aAA_1',
	defaults: 'required',
})
// → ''         (export view materializes it for XSD validity)
```

This resolver backs the [`defaults` option](/api/query#schema-defaults-the-defaults-option) on `getAttribute` / `getAttributes` (read, default `'optional'`) and the export serializer (`'required'`).

### `isSchemaDefaultValue`

Whether a value equals the attribute's schema default, for **compare**: matches the `fixed` value if any, else the `default` (an empty-string default included). Compare sites drop attributes for which this is true, so an authored default-equal value and an absent attribute fold to the same thing. It takes the same `record` as [`getAttributeRules`](#getattributerules).

```ts
import { isSchemaDefaultValue } from '@dialecte/core/utils'

isSchemaDefaultValue({
	dialecteConfig,
	record: bbb1, // a BBB_1 record
	attributeName: 'bBBB_1',
	value: 'false',
})
// → true   ('false' is the schema default)
isSchemaDefaultValue({
	dialecteConfig,
	record: bbb1, // a BBB_1 record
	attributeName: 'bBBB_1',
	value: 'true',
})
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

## XML formatting

### `formatXml`

Formats an XML string to a canonical, readable shape: one structural tag per line, indented by depth, with pure-text leaves kept inline (`<Name ...>text</Name>`). **NON-VALIDATING** and tolerant of `${...}` template interpolations (treated as opaque characters), which is why it is used on XML embedded in JS/TS template literals — a real XML parser silently mis-parses a whole-attribute interpolation like `${templateUuid}` and drops the element. Only the insignificant whitespace _between_ elements is rewritten; attribute and leaf text are preserved verbatim, and mixed text + element content is emitted untouched. Idempotent. Options: `indent` (default `'\t'`), `baseIndent` (default `''`).

```ts
import { formatXml } from '@dialecte/core/utils'

formatXml('<A ${id}="1"><B ${id}="2">t</B></A>')
// <A ${id}="1">
// 	<B ${id}="2">t</B>
// </A>
```

### `formatEmbeddedXml`

Reformats every XML snippet embedded in a JS/TS source string — a template literal preceded by a `/* xml */` marker comment — with `formatXml`, re-indented under the marker's own line with the closing backtick aligned to the statement. The rest of the source is untouched.

It backs the **`dialecte-xmlfmt` bin**, so a consuming package needs no wrapper script:

```jsonc
// package.json
"scripts": {
	"format:xml": "dialecte-xmlfmt 'src/**/*.test.ts'",
	"format:xml:check": "dialecte-xmlfmt --check 'src/**/*.test.ts'"
}
```
