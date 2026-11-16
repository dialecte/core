---
description: Check a simple value against its XSD datatype - validateValue (pure, sync, from @dialecte/core/utils) and the form guard query.validate.value, which judges a value as the child is declared under its parent, before the child exists.
---

# Validation

Core checks values the way an XSD validator does: the built-in types, lists, unions and every facet, read from the dialecte's definition. Two entry points:

- [`validateValue`](#validatevalue) - pure and synchronous, from `@dialecte/core/utils`: one value against one `DataType`.
- [`query.validate.value`](#form-guard-query-validate-value) - the form guard: a value about to be written to an attribute (or the text) of a child under a parent, the child read as declared under that parent. It works before the child exists, and on a transaction it sees the staged writes.

Both return a `ValueIssue` when the value is refused and `undefined` when it is admitted. Nothing is stored. The code under `src/validation` touches no DOM, no store and no `window`: it runs in Node as in the browser.

## `ValueIssue`

Plain data - no function, no class - so it crosses a worker boundary and can be carried as the `meta` of a diagnostic.

| field      | type                                     | meaning                                                                                                                                                          |
| ---------- | ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `reason`   | `ValueIssueReason`                       | the step that refused the value: `'datatype'`, `'enumeration'`, `'pattern'`, `'length'`, `'range'` or `'digits'`                                                 |
| `actual`   | `string`                                 | the value after whitespace normalization; for an item of a list, that item                                                                                       |
| `expected` | `string \| number \| readonly string[]`? | what the step wanted: the built-in name, the members of a union, the enumeration, the pattern sources of the refusing level, the facet value, the admitted types |
| `facet`    | `keyof Facets`?                          | the facet that refused the value (absent for `datatype`)                                                                                                         |

```ts
import type { ValueIssue } from '@dialecte/core'
```

## `validateValue`

```ts
import { validateValue } from '@dialecte/core/utils'

validateValue({ value: ' 150 ', type: { builtin: 'integer', facets: { maxInclusive: '100' } } })
// { reason: 'range', actual: '150', expected: '100', facet: 'maxInclusive' }

validateValue({
	value: 'p:local',
	type: { builtin: 'QName' },
	namespaces: (prefix) => uris[prefix],
})
```

`type` is the definition's `DataType` (`attributes.details[name].type`, `textContent.type`). `namespaces` is a `NamespaceLookup` (prefix to uri, `''` for the default namespace) for QName and NOTATION values; without it only the `xml` prefix is bound. `storedNamespaceLookup` builds one from a record as core stores it.

### The order of the checks

The first step that refuses the value gives the reason.

1. **Whitespace** - `string` keeps it, `normalizedString` turns each tab, line feed and carriage return into a space, every other built-in collapses (spaces folded, leading and trailing ones dropped). A `whiteSpace` facet may tighten that, never loosen it.
2. **The built-in** - its lexical space and its value space (`datatype`).
3. **A list** - collapsed, split on spaces, each item checked against the item type (the first refused item is reported); then the list's own facets, the length family counting items.
4. **A union** - the first member that admits the value gives its normalization and its value; then the union's own facets. No member admitting it is a `datatype` issue whose `expected` lists the members.
5. **The type's own facets**, in this order: `enumeration`, `pattern`, `length` / `minLength` / `maxLength`, the range facets, `totalDigits` / `fractionDigits`.

### Built-ins

Core checks the built-ins itself - never through a pattern written for them:

| built-ins                                                                                             | lexical space and value space                                                                                                         |
| ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `string`, `normalizedString`, `token`                                                                 | XML characters                                                                                                                        |
| `language`                                                                                            | `[a-zA-Z]{1,8}(-[a-zA-Z0-9]{1,8})*`                                                                                                   |
| `Name`, `NCName`, `NMTOKEN`, `ID`, `IDREF`, `ENTITY`, `QName`, `NOTATION`                             | the XML 1.0 name characters libxml2 tests names with (`été` is a name); `ID` / `IDREF` uniqueness and resolution are not checked here |
| `NMTOKENS`, `IDREFS`, `ENTITIES`                                                                      | lists of one item at least                                                                                                            |
| `anyURI`                                                                                              | XML characters, complete percent escapes, one fragment at most, a `:` in the first segment only after a scheme (`urn:x`, not `12:00`) |
| `boolean`                                                                                             | `true`, `false`, `1`, `0`                                                                                                             |
| `decimal`, `integer` and its derived types (`long` … `unsignedByte`, `(non)Positive/NegativeInteger`) | arbitrary precision (`BigInt`); the derived types' bounds are part of their value space                                               |
| `float`, `double`                                                                                     | IEEE (`float` rounded to single precision), `INF`, `-INF`, `NaN`                                                                      |
| `dateTime`, `date`, `time`, `gYearMonth`, `gYear`, `gMonthDay`, `gMonth`, `gDay`                      | the parts in range (days of the month, leap years, `24:00:00`, offsets up to ±14:00, no year `0000`)                                  |
| `duration`                                                                                            | `PnYnMnDTnHnMnS`, at least one part                                                                                                   |
| `hexBinary`, `base64Binary`                                                                           | pairs of hex digits; base64 with its padding rules                                                                                    |
| `anySimpleType`, a built-in core does not know                                                        | any value                                                                                                                             |

### Comparing in value space

`enumeration` and the range facets compare values, not spellings: `1.0` equals `1` for a decimal, `+5` equals `5` for an integer, `1` equals `true` in a union with a `boolean` member (a `boolean` takes no enumeration of its own), `0aff` equals `0AFF`, `PT24H` equals `P1D`, the same instant in two offsets is one value, a QName enumeration compares resolved names (the definition writes them `{uri}local`).

- Floats are ordered as XSD 1.0 orders them: `NaN` equals itself and lies above every other value, `INF` included - so `NaN` passes `minInclusive="0"` and `minExclusive="INF"`, and fails `maxInclusive="INF"`.
- A duration with months and one without are compared from four reference dates; when they disagree (`P1M` against `P30D`) the order is indeterminate.
- **Time zones:** a date or time with an offset and one without compare only when the result holds for every offset from -14:00 to +14:00; otherwise the order is indeterminate. An enumeration never matches a value whose offset presence differs.
- **An indeterminate order refuses the value**, for durations and time zones alike: a range facet requires the value to be ordered against its bound (`≤`, `<`, `≥`, `>`), and an unordered pair is neither. `2026-10-21T20:00:00` fails both `maxInclusive` and `minInclusive="2026-10-21T12:00:00Z"`; `2026-10-22T02:00:01` passes the `minInclusive`. `P1M` fails both `maxInclusive` and `minInclusive="P30D"`. (libxml2 does not compute this indeterminacy for dates and times, so it can disagree.)

### Lengths and digits

- Lengths count characters as XSD does - code points, not UTF-16 units (`a𝒜` is 2 long) - octets for `hexBinary` and `base64Binary`, items for a list. A QName or NOTATION has no length.
- `totalDigits` counts the digits of `i × 10^-n` with `n` the fraction digits once trailing zeros are dropped: leading zeros never count (`000012.300` has 3), zeros between the point and the first digit do (`0.0001` has 4). `fractionDigits` counts the fraction digits without trailing zeros (`1.50` has 1).

### Patterns

A pattern facet holds one list per derivation level: the value must match every level, one pattern of a level is enough. Each level is compiled once, anchored, with the `u` flag, and kept for the next call ([`valuePatterns`](/guide/development/utils#valuepatterns)). An issue's `expected` is the sources of the level that refused the value.

## Form guard: `query.validate.value`

```ts
const issue = await doc.query.validate.value({
	parent: aa1, // a ref or a record you hold
	tagName: 'AAA_1', // the child being edited or about to be created
	xsiType: undefined, // the type the child names with xsi:type, as stored (optional)
	attribute: 'aAAA_1', // absent: the text content
	value: 'ABC',
})
// { reason: 'pattern', actual: 'ABC', expected: ['[a-z]{3}'], facet: 'pattern' }
```

- The definition is the one the child has **under that parent** (`resolveDefinition`): a tag the schema declares differently under two parents is judged as declared under the one given. The child need not exist; when it names (or will name) a type with xsi:type, pass it as `xsiType` (the value as stored) and the child is read as that type - an attribute only a variant declares, or redeclares with other facets, is judged as the variant says. The parent is read once and nothing else - no ancestor, no namespace declaration (records hold none); inside a transaction (`tx.validate.value`) that read sees the staged writes, so a parent added in the same transaction works.
- The type is `attributes.details[attribute].type`, or `textContent.type` without `attribute` - except when `xsiType` names an XSD built-in the declaration admits: the text is then judged as that built-in (`1.5` under `xsi:type` `xs:integer` on an `xs:decimal` element: `datatype`). A plain string attribute, untyped text, an element without text, an attribute a wildcard admits and the `xsi:` attributes other than `xsi:type` are not judged: `undefined`. `attribute` takes the write path's two forms, read by its own reader (`readAttributeInput`) and refused with its keys. A string is a value-object key, the typed name an attribute is stored by: unprefixed, or prefixed with a dialecte prefix (`ext:cA`), `xsi:` or `xml:` (`xml:lang`, `xml:space`: bound everywhere); a prefix the dialecte does not declare (`foo:any`) throws `UNKNOWN_NAMESPACE_PREFIX`. An object is the full-object form `{ name, namespace }`: a local name with a `Namespace` used as given (`{ name: 'any', namespace: { prefix: 'foo', uri: 'urn:foo' } }` under a lax `##other` wildcard: `undefined`) or a config key (`{ name: 'cA', namespace: 'ext' }` is `ext:cA`), or the canonical form (`{ name: 'ext:cA', namespace: <the ext Namespace> }`); any other prefixed name throws `PREFIXED_ATTRIBUTE_NAME`, a namespace key the dialecte does not declare `UNKNOWN_NAMESPACE_PREFIX`.
- A QName value resolves through the engine table (`storedNamespaceLookup`): unprefixed, the dialecte's default namespace; a dialecte prefix, its namespace; `xml:` always bound. A Clark name `{uri}local` is no QName value (`datatype`, `expected: 'QName'`): only an `xsi:type` value, stored resolved, reads one. A QName whose prefix the dialecte does not declare is not judged yet: `undefined`.
- `xsi:type` must be a Clark name (`{uri}local`, read as itself, the form core stores a type of a namespace the dialecte does not declare) or a QName whose prefix the engine table binds - a dialecte prefix, or `xs` for XSD (else `datatype` with `expected: 'QName'`, as a write refuses it with `UNKNOWN_NAMESPACE_PREFIX`) naming a type the declaration admits - its declared type when it is not abstract, its variants, and, when the declared type is an XSD built-in, a built-in derived from it (`xs:integer` under `xs:decimal`; every built-in under an element of no type) - else `datatype` with the admitted Clark names as `expected`. A built-in on an element of a complex type is refused. The write path (`addChild`, `update`, …) follows the same rule (`isXsiTypeAdmitted`), and the `xsiType` param is read by the same reader: one bound nowhere refuses the value (`datatype`, `expected: 'QName'`).
- A wrong argument throws, it is not a value issue:

| case                                                                                       | error                                |
| ------------------------------------------------------------------------------------------ | ------------------------------------ |
| the parent is not found                                                                    | `ELEMENT_NOT_FOUND` (`D2001`)        |
| the parent cannot hold `tagName`                                                           | `INVALID_PARENT_CHILD` (`D3001`)     |
| the child declares no such attribute and no wildcard admits it                             | `INVALID_ATTRIBUTE` (`D3002`)        |
| the object form names a prefixed local name (its canonical form aside)                     | `PREFIXED_ATTRIBUTE_NAME` (`D3007`)  |
| the key's prefix, or the object form's namespace key, is one the dialecte does not declare | `UNKNOWN_NAMESPACE_PREFIX` (`D3006`) |

## Oracle

Core's verdicts are checked against libxml2 (libxml2-wasm, in the Node and browser test projects) by a test-only harness in `src/validation/conformance/`, never exported. **libxml2 says which elements are invalid; the case says why.**

A case is one `.xml` in `cases/` and one row in `oracle.test.ts`:

- **One defect per whole document**, on a base libxml2 accepts (`valid.xml`): a case whose base libxml2 refuses fails by its name. One defect may flag several elements; the row lists each.
- **One element start per line**, and core's record id (`dev:db-id`) on **every** element: libxml2 reports an error on the line where the element's start tag ends, and the harness maps that line to the record id (two starts ending on one line, or an element without an id, fail the case).
- The row's `expected` is `'valid'` or `[{ at, code, attribute? }]`: the record id, the reason the value is refused (`ValueIssue.reason` until the rule codes arrive), the attribute (none for a text value). It is written from the rule and the definition, never from libxml2's wording.

The harness removes the ids in place (lines unchanged), validates with the committed test schema, imports the same document into a test project, scans every typed value and requires the exact match: the same records as libxml2, one issue each, with the case's code and attribute. On a mismatch it prints libxml2's message and path, never parses them.

`known-exceptions.json` lists the values on which core keeps the XSD rule against libxml2's verdict, with the libxml2-wasm version they were probed on (the one the package pins). Each row holds the value, its `DataType`, the `xs:simpleType` named `t` libxml2 judges it against, core's verdict (`'admitted'` or the reason) and a reason from a closed vocabulary: `xsd-rule` (libxml2 departs from the XSD rule) or `capability-gap` (a check core cannot make on a value alone, such as an `ENTITY` declared by the document). The list only shrinks: a row on which both agree fails. Every disagreement class found by comparing `validateValue` with libxml2-wasm over every built-in (about 5,200 value and type pairs) is listed, one sample value per class: empty `NMTOKENS` / `IDREFS`, `anyURI` brackets outside an IP literal, the order of an unzoned against a zoned date bound, `ENTITY` without a DTD, `base64Binary` characters outside the alphabet, years past 32 bits, `float` / `double` exponents without digits.
