---
description: Documents the built-in test helpers and the Rule-of-3 test definition shipped with @dialecte/core. Covers the deterministic tree structure, seeded database utilities, and patterns for writing reliable unit tests against a dialecte.
---

# Testing

Dialecte core provides test helpers and a pre-built test definition to make writing tests straightforward. These utilities are exported from `@dialecte/core/test`.

## runTestCases

The primary test helper. Wraps the full test lifecycle — setup, act, export, assert, cleanup — so tests focus only on what changes.

### Signature

```ts
function runTestCases<GenericTestCase extends BaseTestCase>(params: {
	testCases: TestCases<GenericTestCase>
	act: (params: ActParams<GenericTestCase>) => Promise<ActResult>
	dialecteConfig?: AnyDialecteConfig // defaults to TEST_DIALECTE_CONFIG
}): void
```

### Pattern

```ts
import { describe } from 'vitest'
import { runTestCases, XMLNS_DEFAULT_NAMESPACE, XMLNS_DEV_NAMESPACE } from '@dialecte/core/test'

import type { BaseTestCase, TestCases, ActParams, ActResult } from '@dialecte/core/test'

const testCases: TestCases<BaseTestCase> = {
	'element A updated → attribute aA has new value': {
		sourceXml: `
			<Root ${XMLNS_DEFAULT_NAMESPACE} ${XMLNS_DEV_NAMESPACE} dev:db-id="1">
				<A aA="old" dev:db-id="2"/>
			</Root>
		`,
		expectedQueries: ['//default:A[@aA="new"]'],
		unexpectedQueries: ['//default:A[@aA="old"]'],
	},
}

async function act({ source }: ActParams<BaseTestCase>): Promise<ActResult> {
	await source.document.transaction(async (tx) => {
		await tx.update({ tagName: 'A', id: '2' }, { attributes: { aA: 'new' } })
	})
	return { assertDatabaseName: source.databaseName }
}

describe('A', () => {
	runTestCases({ testCases, act })
})
```

### What it does per test

1. Imports `sourceXml` (and optional `targetXml`) into isolated databases
2. Calls `act` with the mounted documents
3. Exports the database named by `assertDatabaseName` with `withDatabaseIds: true`
4. Runs XPath assertions from `expectedQueries` and `unexpectedQueries`
5. Cleans up all databases

### TestCase shape

```ts
type BaseTestCase = {
	sourceXml: string // input document
	targetXml?: string // second document (for copy/transfer operations)
	only?: boolean // run this case exclusively (it.only)
	expectedQueries?: string[] // XPath expressions that must match
	unexpectedQueries?: string[] // XPath expressions that must not match
}
```

### XPath namespace prefixes

XPath queries run against a namespace-aware document. Each namespace registered in `dialecteConfig.namespaces` is available by its prefix. The default namespace (no prefix in XML) is mapped to `default`.

For dialectes where the root element uses a default namespace (e.g. SCL's `xmlns="http://..."`), **all element names in XPath must be prefixed with `default:`**:

```ts
// ✗ No prefix — fails silently (no match)
expectedQueries: ['//A']

// ✓ Correct prefix
expectedQueries: ['//default:A', '//default:A_1']
```

Attributes do not need a prefix unless they are in a specific namespace (e.g. `dev:db-id`).

```ts
type MyTestCase = BaseTestCase & {
	targetElementId: string
}

const testCases: TestCases<MyTestCase> = {
	'leaf element → moved to target': {
		sourceXml: `...`,
		targetXml: `...`,
		targetElementId: '2',
		expectedQueries: ['//default:A'],
	},
}

async function act({ testCase, source, target }: ActParams<MyTestCase>): Promise<ActResult> {
	// testCase.targetElementId is typed here
	return { assertDatabaseName: target!.databaseName }
}

describe('move', () => {
	runTestCases<MyTestCase>({ testCases, act })
})
```

### Stable record IDs with dev:db-id

During import, `createTestDialecte` always sets `useCustomRecordsIds: true`. Any `dev:db-id` attribute in the XML becomes the actual database record ID — no random UUIDs, no lookups required in `act`.

The attribute name is exported as `CUSTOM_RECORD_ID_ATTRIBUTE` (`"dev:db-id"`).

```xml
<!-- In source XML: assign a predictable ID -->
<A aA="val" dev:db-id="elem-a-1"/>
```

```ts
// In act: reference it directly
await tx.update({ tagName: 'A', id: 'elem-a-1' }, { attributes: { aA: 'updated' } })
```

Because `runTestCases` exports with `withDatabaseIds: true`, the `dev:db-id` attribute is present in the output XML. XPath assertions can target by ID:

```ts
expectedQueries: ['//A[@dev:db-id="elem-a-1"][@aA="updated"]']
```

### Deterministic UUIDs for created elements

When a transaction creates new elements (no `dev:db-id` in the source XML), they receive random UUIDs as their database IDs. `runTestCases` automatically replaces `crypto.randomUUID` with a counter-based mock during the `act` phase, so these IDs are deterministic: `"0"`, `"1"`, `"2"`, ...

This lets tests assert on the generated IDs when needed:

```ts
expectedQueries: ['//default:AA_1[@_temp-idb-id="0"][@aAA_1="created"]']
```

The mock is scoped to each test's act phase. The setup phase (database import) always uses real UUIDs to avoid collisions between parallel tests.

`createMockRandomUUID` is exported if you need the same mock in manual tests outside `runTestCases`:

```ts
import { createMockRandomUUID } from '@dialecte/core/test'

crypto.randomUUID = createMockRandomUUID()
// IDs assigned from here will be "0", "1", "2", ...
```

**Prefer `dev:db-id` over mock UUIDs** when possible — it is more explicit and doesn't couple assertions to creation order. Use mock UUIDs only when the element has no domain attributes that uniquely identify it in the output.

---

## createXmlAssertions

Factory that returns a pair of XPath assertion helpers pre-bound to a namespace resolver. Used directly when tests need manual control over export and assertion (outside `runTestCases`).

### Signature

```ts
function createXmlAssertions(params: { namespaces: Record<string, Namespace> }): {
	assertExpectedElementQueries(params: { xmlDocument: XMLDocument; queries: string[] }): void
	assertUnexpectedElementQueries(params: { xmlDocument: XMLDocument; queries: string[] }): void
}
```

### assertExpectedElementQueries

Each query must match at least one element. On failure, the error shows **exactly which step of the XPath failed** and the XML context at the last successful match:

```
Element not found in XML.
  Failed at step 2/3: /default:AA_1/default:AAA_1[@aAAA_1="val"]
  Full XPath: //default:A[@aA="parent"]/default:AA_1/default:AAA_1[@aAAA_1="val"]
  [Last match at step 1/3]:
  <A aA="parent" ...>...</A>
```

This makes it cheap to write chained paths like `//default:A/default:AA_1/default:AAA_1[...]` — if the `AAA_1` is missing you see immediately whether `A` or `AA_1` was the problem.

### assertUnexpectedElementQueries

Each query must match **zero** elements. Uses the same progressive evaluation: all steps except the last must exist (guards against false positives from a broken test setup), then asserts the final step is absent.

```ts
// All ancestors must exist, only the final target must be absent
unexpectedQueries: ['//default:A[@aA="parent"]/default:AA_1[@aAA_1="deleted"]']
```

### Usage

```ts
import { createTestDialecte, createXmlAssertions } from '@dialecte/core/test'

const { assertExpectedElementQueries } = createXmlAssertions({
	namespaces: MY_DIALECTE_CONFIG.namespaces,
})

const { exportCurrentTest, cleanup } = await createTestDialecte({
	xmlString,
	dialecteConfig: MY_DIALECTE_CONFIG,
})

try {
	// ...transactions...
	const { xmlDocument } = await exportCurrentTest({ withDatabaseIds: true })
	assertExpectedElementQueries({
		xmlDocument,
		queries: ['//default:A[@aA="parent"]/default:AA_1[@aAA_1="updated"]'],
	})
} finally {
	await cleanup()
}
```

In dialecte packages, instantiate once and re-export (see [Adapting to your dialecte](#adapting-to-your-dialecte)).

---

## createTestDialecte

Lower-level helper for tests that need manual control over export, intermediate assertions, or multi-step verification.

### Signature

```ts
async function createTestDialecte(params: {
	xmlString: string
	dialecteConfig?: AnyDialecteConfig // defaults to TEST_DIALECTE_CONFIG
}): Promise<{
	document: Document<Config>
	databaseName: string
	cleanup: () => Promise<void>
	exportCurrentTest: (params?: {
		extension?: string
		withDatabaseIds?: boolean
	}) => Promise<{ xmlDocument: XMLDocument; filename: string }>
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

const {
	document: doc,
	cleanup,
	exportCurrentTest,
} = await createTestDialecte({
	xmlString: `
    <Root ${XMLNS_DEFAULT_NAMESPACE} ${XMLNS_DEV_NAMESPACE} ${CUSTOM_RECORD_ID_ATTRIBUTE}="1">
      <A aA="value" ${CUSTOM_RECORD_ID_ATTRIBUTE}="2"/>
    </Root>
  `,
})

try {
	await doc.transaction(async (tx) => {
		await tx.update({ tagName: 'A', id: '2' }, { attributes: { aA: 'updated' } })
	})

	const { xmlDocument } = await exportCurrentTest({ withDatabaseIds: true })
	// assert manually on xmlDocument...
} finally {
	await cleanup()
}
```

### When to use over runTestCases

- Asserting intermediate states between transactions
- Tests that need multiple exports at different stages
- Lifecycle that doesn't fit the standard source → act → assert → cleanup shape

---

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

Use `createTestRecordFactory` to get a version typed to a specific dialecte config (see [Adapting to your dialecte](#adapting-to-your-dialecte)).

---

## Adapting to your dialecte

Create a single `test.ts` file in your dialecte package that wraps all core helpers with your dialecte config. Tests import from that file instead of `@dialecte/core/test` directly.

### Complete example

```ts
// src/test/test.ts
import { CUSTOM_RECORD_ID_ATTRIBUTE, CUSTOM_RECORD_ID_ATTRIBUTE_NAME } from '@dialecte/core/helpers'
import {
	createTestDialecte,
	createTestRecordFactory,
	createXmlAssertions,
	runTestCases,
	XMLNS_DEV_NAMESPACE,
	TEST_DIALECTE_CONFIG,
} from '@dialecte/core/test'

import type { Config } from '@/config/dialecte.config'

// Namespace strings for use in XML template literals
export const XMLNS_DEFAULT_NAMESPACE = `xmlns="http://dialecte.dev/XML/DEFAULT"`
export const ALL_XMLNS_NAMESPACES = `${XMLNS_DEFAULT_NAMESPACE} ${XMLNS_DEV_NAMESPACE}`
export { CUSTOM_RECORD_ID_ATTRIBUTE, CUSTOM_RECORD_ID_ATTRIBUTE_NAME }

// Wrap runTestCases with the dialecte config
export function runDialecteTestCases<GenericTestCase extends BaseTestCase>(params: {
	testCases: TestCases<GenericTestCase>
	act: (params: ActParams<GenericTestCase>) => Promise<ActResult>
}): void {
	return runTestCases({ ...params, dialecteConfig: TEST_DIALECTE_CONFIG })
}

// Wrap createTestDialecte with the dialecte config
export async function createDialecteTestDialecte(params: { xmlString: string }) {
	return createTestDialecte({ xmlString: params.xmlString, dialecteConfig: TEST_DIALECTE_CONFIG })
}

// Typed record factory — createSclTestRecord({ record: { tagName: 'A', ... } })
export const createDialecteTestRecord = createTestRecordFactory<Config>(TEST_DIALECTE_CONFIG)

// Namespace-aware XPath assertion helpers
export const { assertExpectedElementQueries, assertUnexpectedElementQueries } = createXmlAssertions(
	{ namespaces: TEST_DIALECTE_CONFIG.namespaces },
)
```

### What each export provides

| Export                                                            | Purpose                                                                                   |
| ----------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `runDialecteTestCases`                                            | Table-driven runner pre-bound to the dialecte config                                      |
| `createDialecteTestDialecte`                                      | Manual test setup pre-bound to the dialecte config                                        |
| `createDialecteTestRecord`                                        | Typed record factory — `tagName` is narrowed to the dialecte's elements                   |
| `assertExpectedElementQueries` / `assertUnexpectedElementQueries` | XPath assertions with namespace prefix resolution pre-configured                          |
| Namespace constants                                               | `XMLNS_*` strings for XML template literals; `CUSTOM_RECORD_ID_ATTRIBUTE` for `dev:db-id` |

### Usage in tests

```ts
import { runDialecteTestCases, ALL_XMLNS_NAMESPACES, CUSTOM_RECORD_ID_ATTRIBUTE } from '@/test'

runDialecteTestCases({
	testCases: {
		'element A updated → attribute aA has new value': {
			sourceXml: `
        <Root ${ALL_XMLNS_NAMESPACES} ${CUSTOM_RECORD_ID_ATTRIBUTE}="1">
          <A aA="old" ${CUSTOM_RECORD_ID_ATTRIBUTE}="2"/>
        </Root>
      `,
			expectedQueries: ['//A[@aA="new"]'],
		},
	},
	act: async ({ source }) => {
		await source.document.transaction(async (tx) => {
			await tx.update({ tagName: 'A', id: '2' }, { attributes: { aA: 'new' } })
		})
		return { assertDatabaseName: source.databaseName }
	},
})
```

---

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
