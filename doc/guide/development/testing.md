---
description: Documents the built-in test helpers and the Rule-of-3 test definition shipped with @dialecte/core. Covers the deterministic tree structure, seeded database utilities, and patterns for writing reliable unit tests against a dialecte.
---

# Testing

Dialecte core provides test helpers and a pre-built test definition to make writing tests straightforward. These utilities are exported from `@dialecte/core/test`.

## runTestCases

`runTestCases` is an object with three methods pre-bound to the core test dialecte config.

| Method                       | Use when                                                                    |
| ---------------------------- | --------------------------------------------------------------------------- |
| `runTestCases.generic`       | Sync, pure-function tests — no XML, no async setup                          |
| `runTestCases.withoutExport` | Async tests with direct query assertions (`act` returns `Promise<void>`)    |
| `runTestCases.withExport`    | Async tests with XML export assertions (`act` returns `Promise<ActResult>`) |

---

## runTestCases.generic

Runs synchronous, pure-function table-driven tests. No XML, no async setup.

### Signature

```ts
runTestCases.generic(
	testCases: Record<string, GenericTestCase>,
	act: (testCase: GenericTestCase) => void,
): void
```

### Pattern

```ts
import { describe, expect } from 'vitest'
import { runTestCases } from '@dialecte/core/test'
import type { BaseTestCase } from '@dialecte/core/test'

type TestCase = BaseTestCase & {
	input: string
	expected: boolean
}

const testCases: Record<string, TestCase> = {
	'non-empty string → true': { input: 'hello', expected: true },
	'empty string → false': { input: '', expected: false },
}

function act(tc: TestCase) {
	expect(isNonEmpty(tc.input)).toBe(tc.expected)
}

describe('isNonEmpty', () => {
	runTestCases.generic(testCases, act)
})
```

---

## runTestCases.withoutExport / runTestCases.withExport

Run async table-driven tests backed by a real in-memory database. Import `sourceXml` (and optional `targetXml`), call `act` with the mounted document contexts, then clean up.

Two methods enforce the right contract at call-site.

### Scenario 1 - query assertions only (act returns void)

Use when `act` makes all assertions directly on query results via `expect`. No XML export needed.

```ts
import { describe, expect } from 'vitest'
import { runTestCases, XMLNS_DEFAULT_NAMESPACE, XMLNS_DEV_NAMESPACE } from '@dialecte/core/test'
import type { ActParams, BaseXmlTestCase, TestCases, TestDialecteConfig } from '@dialecte/core/test'

const ns = `${XMLNS_DEFAULT_NAMESPACE} ${XMLNS_DEV_NAMESPACE}`

type TestCase = BaseXmlTestCase & {
	ref: Ref<TestDialecteConfig, 'A'>
	expected: string
}

const testCases: TestCases<TestCase> = {
	'attribute present → returns value': {
		sourceXml: `<Root ${ns}><A dev:db-id="a1" aA="hello"/></Root>`,
		ref: { tagName: 'A', id: 'a1' },
		expected: 'hello',
	},
}

async function act({ source, testCase }: ActParams<TestDialecteConfig, TestCase>): Promise<void> {
	const result = await source.document.query.getAttribute(testCase.ref, { name: 'aA' })
	expect(result).toBe(testCase.expected)
}

describe('getAttribute', () => {
	runTestCases.withoutExport({ testCases, act })
})
```

### Scenario 2 - XML export assertions (act returns ActResult)

Use when `act` performs transactions and assertions must run on the exported XML via XPath. `assertDatabaseName` is **required** in the returned `ActResult`.

```ts
import { describe } from 'vitest'
import { runTestCases, XMLNS_DEFAULT_NAMESPACE, XMLNS_DEV_NAMESPACE } from '@dialecte/core/test'
import type {
	ActParams,
	ActResult,
	BaseXmlTestCase,
	TestCases,
	TestDialecteConfig,
} from '@dialecte/core/test'

const ns = `${XMLNS_DEFAULT_NAMESPACE} ${XMLNS_DEV_NAMESPACE}`

type TestCase = BaseXmlTestCase & {
	newValue: string
}

const testCases: TestCases<TestCase> = {
	'update aA → reflected in export': {
		sourceXml: `<Root ${ns}><A dev:db-id="a1" aA="old"/></Root>`,
		newValue: 'new',
		expectedQueries: ['//default:A[@aA="new"]'],
		unexpectedQueries: ['//default:A[@aA="old"]'],
	},
}

async function act({
	source,
	testCase,
}: ActParams<TestDialecteConfig, TestCase>): Promise<ActResult> {
	await source.document.transaction(async (tx) => {
		await tx.update({ tagName: 'A', id: 'a1' }, { attributes: { aA: testCase.newValue } })
	})
	return { assertDatabaseName: source.databaseName }
}

describe('update', () => {
	runTestCases.withExport({ testCases, act })
})
```

After `act` returns, `runTestCases.withExport` exports the database identified by `assertDatabaseName` and runs XPath assertions from `expectedQueries` / `unexpectedQueries`.

Use `runTestCases.withoutExport` when no export is needed — `act` returns `Promise<void>`, XPath assertions are skipped.

### BaseXmlTestCase shape

```ts
type BaseXmlTestCase = {
	sourceXml: string // input document
	targetXml?: string // second document (for copy/transfer operations)
	only?: boolean // run this case exclusively (it.only)
	expectedQueries?: string[] // XPath expressions that must match (scenario 2)
	unexpectedQueries?: string[] // XPath expressions that must not match (scenario 2)
}
```

### What runXmlTestCases does per test

1. Imports `sourceXml` (and `targetXml` if present) into isolated in-memory databases
2. Calls `act` with the mounted document contexts
3. If `act` returns `ActResult`: exports the named database and runs XPath assertions
4. Cleans up all databases

### Stable record IDs with dev:db-id

During import, `createTestDialecte` always sets `useCustomRecordsIds: true`. Any `dev:db-id` attribute in the XML becomes the actual database record ID — no random UUIDs, no lookups required in `act`.

```xml
<!-- In source XML: assign a predictable ID -->
<A aA="val" dev:db-id="elem-a-1"/>
```

```ts
// In act: reference it directly
await tx.update({ tagName: 'A', id: 'elem-a-1' }, { attributes: { aA: 'updated' } })
```

Because `runXmlTestCases` exports with `withDatabaseIds: true`, the `dev:db-id` attribute is present in the output XML and XPath assertions can target by ID:

```ts
expectedQueries: ['//default:A[@dev:db-id="elem-a-1"][@aA="updated"]']
```

### Deterministic UUIDs for created elements

When a transaction creates new elements (no `dev:db-id` in the source XML), they receive random UUIDs. `runXmlTestCases` replaces `crypto.randomUUID` with a counter-based mock during `act`, so generated IDs are deterministic: `"0"`, `"1"`, `"2"`, ...

```ts
expectedQueries: ['//default:AA_1[@dev:db-id="0"][@aAA_1="created"]']
```

The mock is scoped to each test's act phase. Setup always uses real UUIDs to avoid collisions between parallel tests.

`createMockRandomUUID` is exported for manual tests outside `runXmlTestCases`:

```ts
import { createMockRandomUUID } from '@dialecte/core/test'

crypto.randomUUID = createMockRandomUUID()
// IDs from here: "0", "1", "2", ...
```

Prefer `dev:db-id` over mock UUIDs when possible — more explicit, decoupled from creation order.

### XPath namespace prefixes

The default namespace (no prefix in XML) maps to `default` in XPath. All element names must be prefixed:

```ts
// ✗ fails silently
expectedQueries: ['//A']

// ✓ correct
expectedQueries: ['//default:A']
```

Attributes don't need a prefix unless they are in a specific namespace (e.g. `dev:db-id`).

---

## createXmlAssertions

Factory that returns a pair of XPath assertion helpers pre-bound to a namespace resolver. Used directly when tests need manual control over export and assertion (outside `runXmlTestCases`).

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

### When to use over runXmlTestCases

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
	runXmlTestCases,
	XMLNS_DEV_NAMESPACE,
	TEST_DIALECTE_CONFIG,
} from '@dialecte/core/test'

import type { Config } from '@/config/dialecte.config'

// Namespace strings for use in XML template literals
export const XMLNS_DEFAULT_NAMESPACE = `xmlns="http://dialecte.dev/XML/DEFAULT"`
export const ALL_XMLNS_NAMESPACES = `${XMLNS_DEFAULT_NAMESPACE} ${XMLNS_DEV_NAMESPACE}`
export { CUSTOM_RECORD_ID_ATTRIBUTE, CUSTOM_RECORD_ID_ATTRIBUTE_NAME }

// Wrap runTestCases with no config (pure sync, no config needed)
export { runTestCases }

// Wrap runXmlTestCases with the dialecte config
export function runDialecteXmlTestCases<GenericTestCase extends BaseXmlTestCase>(params: {
	testCases: TestCases<GenericTestCase>
	act: (params: ActParams<GenericTestCase>) => Promise<ActResult | void>
}): void {
	return runXmlTestCases({ ...params, dialecteConfig: TEST_DIALECTE_CONFIG })
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
| `runTestCases`                                                    | Sync table-driven runner for pure-function tests                                          |
| `runDialecteXmlTestCases`                                         | Async XML runner pre-bound to the dialecte config                                         |
| `createDialecteTestDialecte`                                      | Manual test setup pre-bound to the dialecte config                                        |
| `createDialecteTestRecord`                                        | Typed record factory — `tagName` narrowed to the dialecte's elements                      |
| `assertExpectedElementQueries` / `assertUnexpectedElementQueries` | XPath assertions with namespace prefix resolution pre-configured                          |
| Namespace constants                                               | `XMLNS_*` strings for XML template literals; `CUSTOM_RECORD_ID_ATTRIBUTE` for `dev:db-id` |

### Usage in tests

```ts
import { runDialecteXmlTestCases, ALL_XMLNS_NAMESPACES, CUSTOM_RECORD_ID_ATTRIBUTE } from '@/test'

runDialecteXmlTestCases({
	testCases: {
		'element A updated → attribute aA has new value': {
			sourceXml: `
				<Root ${ALL_XMLNS_NAMESPACES}>
					<A aA="old" ${CUSTOM_RECORD_ID_ATTRIBUTE}="a1"/>
				</Root>
			`,
			expectedQueries: ['//default:A[@aA="new"]'],
			unexpectedQueries: ['//default:A[@aA="old"]'],
		},
	},
	act: async ({ source }) => {
		await source.document.transaction(async (tx) => {
			await tx.update({ tagName: 'A', id: 'a1' }, { attributes: { aA: 'new' } })
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
