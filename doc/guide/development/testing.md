---
description: Documents the built-in test helpers and the Rule-of-3 test definition shipped with @dialecte/core. Covers the deterministic tree structure, seeded database utilities, and patterns for writing reliable unit tests against a dialecte.
---

# Testing

Dialecte core provides test helpers and a pre-built test definition to make writing tests straightforward. These utilities are exported from `@dialecte/core`.

## Test definition

The test definition follows a **Rule of 3** pattern — a deterministic, predictable tree structure designed for comprehensive testing.

### Tree structure

```
Root
├── A
│   ├── AA_1
│   │   ├── AAA_1
│   │   │   ├── AAAA_1  (leaf)
│   │   │   ├── AAAA_2  (leaf)
│   │   │   └── AAAA_3  (leaf, ext namespace)
│   │   ├── AAA_2
│   │   └── AAA_3       (ext namespace)
│   ├── AA_2
│   └── AA_3             (ext namespace)
├── B                     (same pattern: BB → BBB → BBBB)
└── C                     (same pattern: CC → CCC → CCCC)
```

**121 elements** total: 1 Root + 3 branches × (1 + 3 + 9 + 27) per branch.

### Naming convention

Each level adds one letter from the branch name. Siblings are numbered `_1`, `_2`, `_3`:

| Level | Branch A                     | Branch B                     | Branch C                     |
| ----- | ---------------------------- | ---------------------------- | ---------------------------- |
| 1     | `A`                          | `B`                          | `C`                          |
| 2     | `AA_1`, `AA_2`, `AA_3`       | `BB_1`, `BB_2`, `BB_3`       | `CC_1`, `CC_2`, `CC_3`       |
| 3     | `AAA_1`, `AAA_2`, `AAA_3`    | `BBB_1`, `BBB_2`, `BBB_3`    | `CCC_1`, `CCC_2`, `CCC_3`    |
| 4     | `AAAA_1`, `AAAA_2`, `AAAA_3` | `BBBB_1`, `BBBB_2`, `BBBB_3` | `CCCC_1`, `CCCC_2`, `CCCC_3` |

### Attributes

Every element has **3 attributes**, prefixed with lowercase `a`, `b`, `c`:

```ts
// For element BBB_1:
aBBB_1 // required, element's namespace
bBBB_1 // optional, element's namespace
cBBB_1 // optional, always ext namespace (qualified)
```

The Root element has two attributes with the same local name but different namespaces:

```ts
root // unqualified, required, default "1"
ext: root // qualified (ext namespace), optional, default "2"
```

### Namespace rules

**Elements:**

| Suffix          | Namespace                              |
| --------------- | -------------------------------------- |
| `_3`            | `ext` (e.g. `AA_3`, `BBB_3`, `CCCC_3`) |
| everything else | `default`                              |

**Attributes:**

| Prefix   | Namespace                          |
| -------- | ---------------------------------- |
| `a`, `b` | Same as the element's namespace    |
| `c`      | Always `ext` (qualified attribute) |

### Namespaces

```ts
const DIALECTE_NAMESPACES = {
	default: { uri: 'http://dialecte.dev/XML/DEFAULT', prefix: '' },
	dev: { uri: 'http://dialecte.dev/XML/DEV', prefix: 'dev' },
	ext: { uri: 'http://dialecte.dev/XML/DEV-EXT', prefix: 'ext' },
}
```

### XML example

```xml
<Root xmlns="http://dialecte.dev/XML/DEFAULT"
      xmlns:ext="http://dialecte.dev/XML/DEV-EXT">
  <!-- default namespace element, c attribute qualified -->
  <A aA="val" bA="val" ext:cA="val">
    <!-- ext namespace element (_3 suffix) -->
    <ext:AA_3 ext:aAA_3="val" ext:bAA_3="val" ext:cAA_3="val"/>
  </A>
</Root>
```

## createTestDialecte

Creates a fully configured `Document` instance from an XML string for testing. Handles import, database creation, and cleanup.

### Signature

```ts
async function createTestDialecte(params: {
	xmlString: string
	dialecteConfig?: AnyDialecteConfig // defaults to TEST_DIALECTE_CONFIG
}): Promise<{
	document: Document<Config>
	databaseName: string
	cleanup: () => Promise<void>
	exportCurrentTest: (params?) => Promise<{ xmlDocument: XMLDocument; filename: string }>
	assertExpectedElementQueries: (xmlDocument, queries) => void
	assertUnexpectedElementQueries: (xmlDocument, queries) => void
}>
```

### Usage

```ts
import {
	createTestDialecte,
	XMLNS_DEFAULT_NAMESPACE,
	CUSTOM_RECORD_ID_ATTRIBUTE,
	XMLNS_DEV_NAMESPACE,
} from '@dialecte/core/test'

const { document: doc, cleanup } = await createTestDialecte({
	xmlString: `
    <Root ${XMLNS_DEFAULT_NAMESPACE} ${XMLNS_DEV_NAMESPACE} ${CUSTOM_RECORD_ID_ATTRIBUTE}="1">
      <A aA="value" ${CUSTOM_RECORD_ID_ATTRIBUTE}="2"/>
    </Root>
  `,
})

// Query
const record = await doc.query.getRecord({ tagName: 'A', id: '2' })

// Mutate
await doc.transaction(async (tx) => {
	await tx.update({ tagName: 'A', id: '2' }, { attributes: { aA: 'updated' } })
})

// Export and assert XML
const { xmlDocument } = await exportCurrentTest()
assertExpectedElementQueries(xmlDocument, ['//A[@aA="updated"]'])

// Always cleanup after test
await cleanup()
```

### What it does

1. Wraps the XML string in a `File` object
2. Imports it via `importXmlFiles` with `useCustomRecordsIds: true` (preserves `dev:db-id` as record IDs)
3. Creates a `Document` instance connected to the database
4. Returns a `cleanup` function that destroys the database

::: tip
Use `dev:db-id` attributes in your XML to set predictable record IDs. This makes assertions easier:

```xml
<Root ${XMLNS_DEFAULT_NAMESPACE} ${XMLNS_DEV_NAMESPACE} ${CUSTOM_RECORD_ID_ATTRIBUTE}="root-1">
  <A aA="val" ${CUSTOM_RECORD_ID_ATTRIBUTE}="a-1"/>
</Root>
```

Then in your test: `doc.query.getRecord({ tagName: 'A', id: 'a-1' })`
:::

## createTestRecord

Creates a standardized test record with sensible defaults. Supports three output formats.

### Signature

```ts
function createTestRecord(params: {
	type?: 'raw' | 'tracked' | 'tree' // default: 'raw'
	record: {
		tagName: ElementsOf<Config>
		attributes?: AttributesValueObjectOf | FullAttributeObjectOf[]
		// ...other RawRecord fields (optional)
	}
}): RawRecord | TrackedRecord | TreeRecord
```

### Usage

```ts
import { createTestRecord } from '@dialecte/core/test'

// Raw record (database format)
const raw = createTestRecord({
	record: { tagName: 'A', attributes: { aA: 'value' } },
})

// Tracked record (with status field)
const tracked = createTestRecord({
	type: 'tracked',
	record: { tagName: 'A', attributes: { aA: 'value' } },
})

// Tree record (with tree[] instead of children[])
const tree = createTestRecord({
	type: 'tree',
	record: { tagName: 'A', attributes: { aA: 'value' } },
})
```
