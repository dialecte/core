---
description: Documents the built-in test helpers and the Rule-of-3 test definition shipped with @dialecte/core. Covers the deterministic tree structure, seeded database utilities, and patterns for writing reliable unit tests against a dialecte.
---

# Testing

Dialecte core provides test helpers and a pre-built test definition to make writing tests straightforward. These utilities are exported from `@dialecte/core/test`.

## runTestCases

`runTestCases` is an object with three methods pre-bound to the core test dialecte config.

| Method                       | Use when                                                                    |
| ---------------------------- | --------------------------------------------------------------------------- |
| `runTestCases.generic`       | Sync, pure-function tests - no XML, no async setup                          |
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
import { runTestCases } from '@dialecte/core/test'
import { describe, expect } from 'vitest'

import type { BaseTestCase } from '@dialecte/core/test'

type TestCase = BaseTestCase & {
	input: string
	expected: boolean
}

const testCases: Record<string, TestCase> = {
	'non-empty string -> true': { input: 'hello', expected: true },
	'empty string -> false': { input: '', expected: false },
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

Run async table-driven tests backed by a real store (the local one unless [another is chosen](#choosing-the-store)). Import `sourceXml` (and optional `targetXml`), call `act` with the mounted document contexts, then clean up.

Two methods enforce the right contract at call-site.

### Scenario 1 - query assertions only (act returns void)

Use when `act` makes all assertions directly on query results via `expect`. No XML export needed.

```ts
import { runTestCases, XMLNS_DEFAULT_NAMESPACE, XMLNS_DEV_NAMESPACE } from '@dialecte/core/test'
import { describe, expect } from 'vitest'

import type { ActParams, BaseXmlTestCase, TestCases, TestDialecteConfig } from '@dialecte/core/test'

const ns = `${XMLNS_DEFAULT_NAMESPACE} ${XMLNS_DEV_NAMESPACE}`
// DIALECTE_TEST_NAMESPACES is also available: { default, dev, xsi, ext }

type TestCase = BaseXmlTestCase & {
	ref: Ref<TestDialecteConfig, 'A'>
	expected: string
}

const testCases: TestCases<TestCase> = {
	'attribute present -> returns value': {
		sourceXml: `<Root ${ns}><A dev:db-id="a1" aA="hello"/></Root>`,
		ref: { tagName: 'A', id: 'a1' },
		expected: 'hello',
	},
}

async function act({ source, testCase }: ActParams<TestDialecteConfig, TestCase>): Promise<void> {
	const result = await source.query.getAttribute(testCase.ref, { name: 'aA' })
	expect(result).toBe(testCase.expected)
}

// project is also available in ActParams for multi-document operations:
// async function act({ project, source, testCase }: ActParams<...>) { ... }

describe('getAttribute', () => {
	runTestCases.withoutExport({ testCases, act })
})
```

### Scenario 2 - XML export assertions (act returns ActResult)

Use when `act` performs transactions and assertions must run on the exported XML via XPath.

```ts
import { runTestCases, XMLNS_DEFAULT_NAMESPACE, XMLNS_DEV_NAMESPACE } from '@dialecte/core/test'
import { describe } from 'vitest'

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
	'update aA -> reflected in export': {
		sourceXml: `<Root ${ns}><A dev:db-id="a1" aA="old"/></Root>`,
		newValue: 'new',
		expectedQueries: ['//default:A[@aA="new"]'],
		unexpectedQueries: ['//default:A[@aA="old"]'],
	},
}

async function act({
	project,
	source,
	testCase,
}: ActParams<TestDialecteConfig, TestCase>): Promise<ActResult> {
	await source.transaction(async (tx) => {
		await tx.update({ tagName: 'A', id: 'a1' }, { attributes: { aA: testCase.newValue } })
	})
	return { assertOn: 'source' }
}

describe('update', () => {
	runTestCases.withExport({ testCases, act })
})
```

After `act` returns, `runTestCases.withExport` exports the document identified by `assertOn` (`'source'` by default, or `'target'` for cross-document operations) and runs XPath assertions from `expectedQueries` / `unexpectedQueries`.

To assert against XML produced **inside** the act — for example `getSnapshot({ as: 'xml' })` — return `{ assertOn: 'custom', xmlString }`. The runner parses that string and runs the same `expectedQueries` / `unexpectedQueries` matcher against it, instead of exporting the stored document:

```ts
async function act({ source, testCase }): Promise<ActResult> {
	const { tree, xmlString } = await source.query.getSnapshot({ ref, as: 'both' })
	// ...assert tree shape inline...
	return { assertOn: 'custom', xmlString }
}
```

Use `runTestCases.withoutExport` when no export is needed - `act` returns `Promise<void>`, XPath assertions are skipped.

### ActResult

```ts
type ActResult =
	| {
			assertOn?: 'source' | 'target' // default: 'source'
			withDatabaseIds?: boolean // default: true
	  }
	| {
			assertOn: 'custom' // assert queries against `xmlString`
			xmlString: string // XML produced in the act, e.g. a getSnapshot output
	  }
```

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

### What runTestCases does per test

1. Creates an isolated `Project` with source (and optionally target) XML imported via `createTestProject`
2. Calls `act` with `{ project, source, target?, testCase }` - the project instance and mounted documents
3. If `act` returns `ActResult`: exports the source or target document as text (or takes the `xmlString` of `assertOn: 'custom'`) and runs the XPath assertions on it
4. Destroys the project (cleans up all databases)

The `project` instance is useful for multi-document operations (e.g. importing additional files, or exporting intermediate states).

### Stable record IDs with dev:db-id

During import, `createTestProject` always sets `useCustomRecordsIds: true`. Any `dev:db-id` attribute in the XML becomes the actual database record ID - no random UUIDs, no lookups required in `act`.

```xml
<!-- In source XML: assign a predictable ID -->
<A aA="val" dev:db-id="elem-a-1"/>
```

```ts
// In act: reference it directly
await tx.update({ tagName: 'A', id: 'elem-a-1' }, { attributes: { aA: 'updated' } })
```

Because `runTestCases.withExport` exports with `withDatabaseIds: true`, every element of the output XML carries its record id as `_temp-idb-id`, and XPath assertions can target by ID:

```ts
expectedQueries: ['//default:A[@_temp-idb-id="elem-a-1"][@aA="updated"]']
```

### Deterministic UUIDs for created elements

When a transaction creates new elements (no `dev:db-id` in the source XML), they receive random UUIDs. `runTestCases` replaces `crypto.randomUUID` during `act` with ids that follow from a seed: UUID-shaped (version 4 layout), the same sequence on every run.

```ts
import { createSeededRandomUuid } from '@dialecte/core/utils'

const firstCreatedId = createSeededRandomUuid({ seed: 0 })()
expectedQueries: [`//default:AA_1[@_temp-idb-id="${firstCreatedId}"][@aAA_1="created"]`]
```

The mock is scoped to each test's act phase. Setup always uses real UUIDs to avoid collisions between parallel tests.

`createMockRandomUUID({ seed? })` is exported for manual tests outside `runTestCases` (seed 0 by default); it is `createSeededRandomUuid` from `@dialecte/core/utils`, which a script outside vitest uses directly:

```ts
import { createMockRandomUUID } from '@dialecte/core/test'

crypto.randomUUID = createMockRandomUUID()
// ids from here: the seed-0 sequence, each in the layout of a UUID
```

Prefer `dev:db-id` over mock UUIDs when possible - more explicit, decoupled from creation order.

### Stable snapshots - `normalizeUuids`

A snapshot of a whole document (`getSnapshot({ as: 'xml' })` → `toMatchSnapshot`) freezes uuid VALUES, which are random - and for elements minted during setup (before any `act` mock) not even deterministic. Rather than mock `crypto.randomUUID` around the whole test, normalize the OUTPUT: `normalizeUuids` rewrites every uuid to a stable first-appearance token (`uuid-1`, `uuid-2`, …), the same uuid always mapping to the same token so lineage - a `templateUuid` pointing at an element's `uuid`, a reference's target - stays visible.

```ts
import { normalizeUuids } from '@dialecte/core/test'

const xml = await target.query.getSnapshot({ as: 'xml' })
expect(normalizeUuids(xml)).toMatchSnapshot()
```

The snapshot then depends on structure + lineage, never on the random values - immune to uuid ordering or a leaked mock, and with no `crypto.randomUUID` mocking in the test. A real structural or lineage change still moves it. Preferred for document snapshots.

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

Factory that returns a pair of XPath assertion helpers pre-bound to the dialecte's namespaces: the XPath prefixes are the config's namespace keys (`default`, `ext`, ...). Used directly when tests need manual control over export and assertion (outside `runTestCases`).

The assertions read XML the same way in node and in a browser: they parse and query with libxml2 (compiled to WebAssembly, bundled into `@dialecte/core/test`), never with the page's `DOMParser` or `document.evaluate`. They take XML **text** only - what `project.export` writes (`await file.text()`); a caller holding a page `Document` serializes it first. Each call parses its text once, for all its queries; `runTestCases` parses a case's output once for its expected and unexpected queries.

### Signature

```ts
function createXmlAssertions(params: { namespaces: Record<string, Namespace> }): XmlAssertions

type XmlAssertions = {
	assertExpectedElementQueries(params: XmlQueriesParams): void
	assertUnexpectedElementQueries(params: XmlQueriesParams): void
}
type XmlQueriesParams = { xml: string; queries: string[] }
```

`XmlAssertions`, `XmlQueriesParams` and `XmlQueriesWithNamespacesParams` (the module-level assertions' parameter, with the `namespaces` to read the prefixes with) are exported from `@dialecte/core/test`: a dialecte that re-exports the assertions types them with these names. Every type named in the signature of a function of `@dialecte/core/test` is exported from it.

XML text that is not well-formed is refused with `queried XML: malformed XML - <line>:<column> <libxml2's reason>`. As in XPath 1.0: namespace declarations are not attributes (`@*` and `count(@*)` leave them out), the XML declaration and the whitespace around the root are no nodes of the document, and a query naming a prefix the namespaces do not bind is refused, whatever the document.

### XPath for small exact output, record expectations for big files

A query pins one fact of a small, exact output: an element, its attributes, its place. On a big export (a whole substation, megabytes) a long list of XPath queries is hard to read and slow to fail: assert on the records instead - `query.findDescendants(parent, { collect: [{ AA_1: { where: { aAA_1: 'v1' } } }] })` for the records of a tag holding the attributes they must have, under a `parent` read with `query.getRecord(ref)` - and keep XPath for the few places where the written XML itself is the point.

### assertExpectedElementQueries

Each query must select at least one node. On failure the message says, in labelled lines, which step of the XPath matched last, which step failed, where the last match sits, what the failing step finds there without its predicates, and the XML around it (cut at 200 lines):

```
Expected element not found
  query    //default:A[@aA="a1"]/default:AA_1[@aAA_1="zz"]
  matched  //default:A[@aA="a1"]  step 1 of 2
  failed                        /default:AA_1[@aAA_1="zz"]
  at       /Root[1]/A[1]  line 2
  nearby   AA_1 aAA_1="v1" (line 3), AA_1 aAA_1="v2" (line 4)
  context
    <A aA="a1">
      <AA_1 aAA_1="v1"/>
      <AA_1 aAA_1="v2" other="o"/>
    </A>
```

- `nearby` evaluates the failing step without its predicates under every node the matched steps select: up to ten candidates with the attributes the predicates name, or `none: A has no AA_1 child` when the name itself is absent - then the same local name in another namespace is named with the prefix to type (`ext:AA_3 exists (ext = <uri>)`).
- libxml2 keeps a node's line up to 65535; past it the message says `line ≥ 65535`.
- A query with a top-level `|` (a union) is reported as a whole: its branches have no common steps.
- A query the engine refuses (a syntax error, a prefix the namespaces do not bind, an expression that answers a number, a string or a boolean) fails as `Query refused`, with the query and the reason.

This makes it cheap to write chained paths like `//default:A/default:AA_1/default:AAA_1[...]` - if the `AAA_1` is missing you see immediately whether `A` or `AA_1` was the problem.

### assertUnexpectedElementQueries

Each query must select **no** node. Every step but the last must still select one (guards against a pass for the wrong reason: a broken test setup), then the whole query must select nothing. A node found is printed with its place (`Unexpected element found`, `at`, `element`); a missing ancestor fails as `Unexpected element check unreliable`, with the same lines as an expected query.

```ts
// All ancestors must exist, only the final target must be absent
unexpectedQueries: ['//default:A[@aA="parent"]/default:AA_1[@aAA_1="deleted"]']
```

### Usage

```ts
import { createTestProject, createXmlAssertions } from '@dialecte/core/test'

const { assertExpectedElementQueries } = createXmlAssertions({
	namespaces: MY_DIALECTE_CONFIG.namespaces,
})

const { project, source } = await createTestProject({
	sourceXml: xmlString,
	dialecteConfig: MY_DIALECTE_CONFIG,
})

try {
	// ...transactions on source.document...
	const { file } = await project.export({
		documentId: source.documentId,
		indent: false,
		withDatabaseIds: true,
	})
	const xml = await file.text()
	assertExpectedElementQueries({
		xml,
		queries: ['//default:A[@aA="parent"]/default:AA_1[@aAA_1="updated"]'],
	})
} finally {
	await project.destroy()
}
```

In dialecte packages, instantiate once and re-export (see [Adapting to your dialecte](#adapting-to-your-dialecte)).

---

## createXmlSchemaAssertions

Factory that returns structural-validation assertions pre-bound to a dialecte's generated `DEFINITION` and `TYPES` and its declared `namespaces`. Where `createXmlAssertions` checks specific XPath queries, `createXmlSchemaAssertions` validates a whole XML string against the schema shape: every element's namespace matches its parent context, every element is an allowed child of its parent, and every attribute is one its element may carry - as declared, or as the type it names with `xsi:type` declares. Use it to guard test fixtures - a mistyped tag, a wrong namespace or an attribute the element does not declare fails loudly instead of silently exercising the wrong shape.

### Signature

```ts
function createXmlSchemaAssertions(params: {
	definition: AnyDefinition
	types: AnyTypes // the TYPES generated beside DEFINITION
	namespaces: Record<string, Namespace>
	schemaName?: string // names the schema in messages ("not valid SCL"); default 'XML'
}): {
	assertValidXml(params: { xml: string; label?: string; requireComplete?: boolean }): void
	assertValidXmlTestCases(params: {
		testCases: Record<string, { sourceXml: string; targetXml?: string }>
	}): void
}
```

### assertValidXml

Throws with every violation found, each tagged `[namespace]` / `[containment]` / `[attribute]` / `[required]`. Elements unknown to the schema are skipped (bespoke content under a transparent `Private`), as is any element in a namespace the dialecte does not declare - even when its local name collides with a schema element. An element in **no** namespace is not foreign - it is a schema element that forgot its namespace, and stays validated.

Attributes are checked in every namespace, against the declaration that applies to the element under its parent and the type it names with `xsi:type`:

- an attribute of a namespace the dialecte declares is looked up under the dialecte's prefix, whatever prefix the document binds to that namespace: `x:unknown`, with `x` bound to the `ext` namespace, is reported as `'ext:unknown'`;
- an attribute of a namespace the dialecte does not declare is reported too, unless the element's attribute wildcard admits its namespace (`##any`, `##other`, a namespace list); an unprefixed attribute the element does not declare passes only where the wildcard admits no namespace;
- namespace declarations (`xmlns`, `xmlns:*`), `xsi:*` and the test record id (`dev:db-id`) are always allowed.

The check walks the document libxml2 parses. XML that is not well-formed (a bare `&`, a tag closed by another name, a prefix bound to the empty namespace) is refused as `<label>: malformed XML - <line>:<column> <libxml2's reason>`; an XML declaration after leading whitespace (a template-literal snippet starting with a newline) is refused as `<label>: malformed XML - the XML declaration must be the very first characters ...`; `label` defaults to `'test XML'`.

`requireComplete` (default `true`) also requires every schema-required attribute; a required attribute of a dialecte namespace is found under any prefix the document binds to it. Minimal fixtures pass `false`.

### assertValidXmlTestCases

Validates every case's `sourceXml`/`targetXml` and throws ONCE listing all invalid cases, each attributed to its case name - so a suite's fixtures are fixed in one round instead of one failure at a time.

### Usage

```ts
import { createXmlSchemaAssertions } from '@dialecte/core/test'

const { assertValidXml } = createXmlSchemaAssertions({
	definition: MY_DEFINITION,
	types: MY_TYPES,
	namespaces: MY_DIALECTE_CONFIG.namespaces,
	schemaName: 'SCL',
})

assertValidXml({ xml: fixtureXml, label: 'my fixture', requireComplete: false })
```

Not yet enforced (planned with the validation feature): attribute value facets (uuid pattern, enums, datatypes) and cross-element constraints (unique keys, keyref resolution). In dialecte packages, instantiate once and re-export (see [Adapting to your dialecte](#adapting-to-your-dialecte)).

---

## createTestProject

Lower-level helper for tests that need manual control over export, intermediate assertions, or multi-step verification. Spins up a `Project` with source (and optionally target) XML imported.

### Signature

```ts
async function createTestProject<
	GenericConfig extends AnyDialecteConfig,
	GenericModules extends ExtensionModules = Record<never, never>,
>(params: {
	dialecte?: DialecteDeclaration<GenericConfig, GenericModules> // from defineDialecte; TEST_DIALECTE when absent
	sourceXml: string
	targetXml?: string
	storage?: StorageParam // the local store by default, { type: 'inMemory' } on request
	dev?: { perf?: boolean }
}): Promise<{
	project: Project<GenericConfig, GenericModules>
	source: { documentId: string; document: Document<GenericConfig> }
	target?: { documentId: string; document: Document<GenericConfig> }
}>
```

The project is the declaration's: every config, the default key, the dialecte's extensions and its own hooks instance. The source (and the target) are imported under the default config. Opened inside a running test, the project is destroyed when the test ends ([Teardown](#teardown)).

Without a `dialecte`, the project is core's own test dialecte (`TEST_DIALECTE`, its one config under the key `default`). Passing `dialecteConfig`, `extensions` and `hooks` one by one still works and is deprecated: the one config goes under the key `default` and the hooks instance given is shared by every project.

### Usage

```ts
import {
	createTestProject,
	TEST_DIALECTE,
	XMLNS_DEFAULT_NAMESPACE,
	CUSTOM_RECORD_ID_ATTRIBUTE,
	XMLNS_DEV_NAMESPACE,
} from '@dialecte/core/test'

const { project, source } = await createTestProject({
	dialecte: TEST_DIALECTE,
	sourceXml: `
    <Root ${XMLNS_DEFAULT_NAMESPACE} ${XMLNS_DEV_NAMESPACE} ${CUSTOM_RECORD_ID_ATTRIBUTE}="1">
      <A aA="value" ${CUSTOM_RECORD_ID_ATTRIBUTE}="2"/>
    </Root>
  `,
})

try {
	await source.document.transaction(async (tx) => {
		await tx.update({ tagName: 'A', id: '2' }, { attributes: { aA: 'updated' } })
	})

	const { file } = await project.export({
		documentId: source.documentId,
		indent: false,
		withDatabaseIds: true,
	})
	const xml = await file.text()
	// assert on xml, e.g. with assertExpectedElementQueries({ xml, queries })
} finally {
	await project.destroy()
}
```

### When to use over runTestCases

- Asserting intermediate states between transactions
- Tests that need multiple exports at different stages
- Lifecycle that doesn't fit the standard source -> act -> assert -> cleanup shape

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

Use `createTestRecordFactory(config)` to get a version typed to a specific dialecte config; a dialecte package gets it bound to its declaration as `createTestRecord` from `createTestHelpers` (see [Adapting to your dialecte](#adapting-to-your-dialecte)).

```ts
const createMyTestRecord = createTestRecordFactory(MY_DIALECTE_CONFIG)
```

---

## Adapting to your dialecte

Create a single `test.ts` file in your dialecte package. One `createTestHelpers({ dialecte })` call derives every helper from the dialecte's declaration; tests import from that file instead of `@dialecte/core/test` directly.

### Complete example

```ts
// src/test/test.ts
import { CUSTOM_RECORD_ID_ATTRIBUTE, CUSTOM_RECORD_ID_ATTRIBUTE_NAME } from '@dialecte/core/helpers'
import { createTestHelpers, XMLNS_DEV_NAMESPACE } from '@dialecte/core/test'

import { MY_DIALECTE } from '@/declaration' // defineDialecte({ id, version, configs, defaultConfigKey, extensions, createHooks })

// Namespace strings for use in XML template literals
export const XMLNS_DEFAULT_NAMESPACE = `xmlns="http://dialecte.dev/XML/DEFAULT"`
export const ALL_XMLNS_NAMESPACES = `${XMLNS_DEFAULT_NAMESPACE} ${XMLNS_DEV_NAMESPACE}`
export { CUSTOM_RECORD_ID_ATTRIBUTE, CUSTOM_RECORD_ID_ATTRIBUTE_NAME }

export const {
	runTestCases: runDialecteTestCases,
	createTestProject: createDialecteTestProject,
	createTestRecord: createDialecteTestRecord,
	assertExpectedElementQueries,
	assertUnexpectedElementQueries,
	assertValidXml,
	assertValidXmlTestCases,
} = createTestHelpers({ dialecte: MY_DIALECTE, schemaName: 'MyDialecte' })
```

`createTestHelpers({ dialecte, storage?, schemaName?, extraChecks? })` builds every helper on the declaration. A runner call and a test project take a `configKey` (a dialecte with two configs, such as nsd and NSDoc): the fixtures are imported under it and checked against its schema; without one, the default config. `storage` names the store the test projects run on (the local store by default); `schemaName` names the schema in fixture violation messages (the dialecte's `id` by default). A check a dialecte adds of its own (scl's coherent references) goes in `extraChecks` (`testCases` for a runner call, `fixture` for each test-project fixture), run after the schema check; a test project skips it with `skipExtraChecks: '<why>'`.

### What each helper provides

| Helper                                                            | Purpose                                                                                                                                                      |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `runTestCases`                                                    | The runner (`.withExport`, `.withoutExport`, `.generic`) on the declaration; every case's XML is checked against the schema first, all invalid cases at once |
| `createTestProject`                                               | Manual test setup on the declaration; the source and target are checked against the schema (required attributes may be left out)                             |
| `createTestRecord`                                                | Typed record factory - `tagName` narrowed to the dialecte's elements                                                                                         |
| `assertExpectedElementQueries` / `assertUnexpectedElementQueries` | XPath assertions with namespace prefix resolution pre-configured                                                                                             |
| `assertValidXml` / `assertValidXmlTestCases`                      | Structural fixture validation (namespace / containment / attributes) bound to the schema                                                                     |

Each comes from a lower-level builder of this page, still exported for a case the bundle does not fit: `createTestRunner({ dialecte, storage? })` (the runner of [runTestCases](#runtestcases) on a declaration, without the fixture check), [createTestProject](#createtestproject), [createTestRecordFactory](#createtestrecord), [createXmlAssertions](#createxmlassertions) and [createXmlSchemaAssertions](#createxmlschemaassertions).

The bundle does not derive the `xmlns` strings a dialecte's fixtures use in template literals, nor the record-id re-exports: those stay the dialecte's own. A helper is renamed in the destructure (`assertValidXml: assertValidSclXml`).

### Usage in tests

```ts
import { runDialecteTestCases, ALL_XMLNS_NAMESPACES, CUSTOM_RECORD_ID_ATTRIBUTE } from '@/test'

runDialecteTestCases.withExport({
	testCases: {
		'element A updated -> attribute aA has new value': {
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
		await source.transaction(async (tx) => {
			await tx.update({ tagName: 'A', id: 'a1' }, { attributes: { aA: 'new' } })
		})
		return { assertOn: 'source' }
	},
})
```

---

## Test definition

The test definition follows a **Rule of 3** pattern - a deterministic, predictable tree structure designed for comprehensive testing.

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
├── B                     (same pattern: BB -> BBB -> BBBB)
└── C                     (same pattern: CC -> CCC -> CCCC)
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

---

## Choosing the store

Every helper of this page opens its projects on the store a call names (`storage` on `createTestHelpers`, `createTestRunner`, `createTestProject` and `createTestContext`), else on the runner's default set by `useTestStorage`, else on the local store (IndexedDB). `{ type: 'inMemory' }` is the fast choice for unit and mutation runs; `{ type: 'sqlite' }` runs the SQLite engine; the local store is the one storage paths and end-to-end runs need.

### The store is a switch

A test gives the same result on every store; only its speed changes. A difference is a store bug, and the store contract suite of core (`src/store/contract`) runs every case on every store to keep it so. What a test may rely on, whichever the store:

- **One state per project.** Every store, and every project, opened for a project - its name and its dialecte (the local store: its name alone, until it moves to SQLite) - reads and writes one state: a project closed and opened again under its name finds its documents. `close()` keeps that state; `destroy()` frees it - refused (`PROJECT_OPEN_ELSEWHERE`, nothing removed) while another store or project of the project is open: close the others first, awaiting each `close()` (it settles once that store counts no more). A store closed counts open no more (a destroy lets the operations it still runs complete first; a store of another tab counts until they end), and neither does one destroyed, until it is used again. In memory the state is the page's (a test worker's), as an IndexedDB database is the origin's.
- **Records are values.** What a test reads or hands the store is its own copy: changing it never changes the store.
- **List reads in id order.** `getDocuments`, `getByDocumentId`, `getByTagNameInDocument` and the blob lists answer in record-id order, and so do the queries built on them. With random ids (an import without `useCustomRecordsIds`, `initEmptyDocument`) that order is random: compare such lists as sets.

### Picking the store for a package's runs

The store is the runner's choice, not each test's. A vitest project lists a setup file that calls `useTestStorage` from `@dialecte/core/test`: every helper of that run opens its projects there when a call names no store. It is set for the process, never read from an environment variable; a call's own `storage` still wins.

```ts
// test/in-memory-storage.setup.ts - the setup of the node project
import { useTestStorage } from '@dialecte/core/test'

useTestStorage({ type: 'inMemory' })
```

`{ type: 'sqlite' }` in the test helpers is the SQLite engine run in the test's own process (the engine a project on `sqlite` storage reaches in a worker, its file in memory): the helpers know the dialecte, not its engine worker, so it is the same kind in node and in a browser. Like an app, a test opts into it: the setup file imports `@dialecte/core/sqlite` (without it the kind is refused `PROJECT_SQLITE_NOT_IMPORTED`). A second vitest project with a setup file importing it and calling `useTestStorage({ type: 'sqlite' })` runs a package's Document and Query suites on SQLite with no test changed, as core's `node-sqlite` project does (`createTestContext` by name names the project's `dialecteId` there). Node is the proven tier; a browser run of it is best effort (sqlite-wasm resolves its wasm itself: the test project may need `optimizeDeps.exclude: ['@sqlite.org/sqlite-wasm']`, as core's own browser projects set). Its code is loaded only by a run on it.

```ts
// vitest.config.ts - two tiers
projects: [
	{
		test: {
			name: 'node',
			environment: 'node',
			include: ['src/**/*.test.ts'],
			exclude: BROWSER_ONLY_TEST_FILES.map((file) => file.path), // { path, why } each
			setupFiles: ['test/in-memory-storage.setup.ts'],
		},
	},
	{
		test: {
			name: 'browser',
			browser: { ... },
			include: BROWSER_ONLY_TEST_FILES.map((file) => file.path),
		},
	},
	{ test: { name: 'browser-all', browser: { ... }, include: ['src/**/*.test.ts'] } },
]
```

The browser projects set no default: their tests run on the local store. A test that needs a given store whatever the run (an IndexedDB path, a store's own behaviour) opens its own project on it, `createTestProject({ sourceXml, storage: { type: 'local' } })`, and its file is one of the browser-only ones.

### The two tiers of core

| Project          | Runs                                                                                                                                                             | Store                                                                                                                           | When                                                                      |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| `node`           | every test file but the browser-only ones                                                                                                                        | in-memory, from `useTestStorage`                                                                                                | each step (`npm run test:node`, the pre-commit hook)                      |
| `node-sqlite`    | the Document and Query suites (`src/document`)                                                                                                                   | SQLite in the test's own process, from `useTestStorage({ type: 'sqlite' })`                                                     | with `node`                                                               |
| `node-indexeddb` | the store contract and the project's store switch                                                                                                                | in-memory, IndexedDB through `fake-indexeddb`, and SQLite in the test's own process (the in-process engine, its file in memory) | with `node`                                                               |
| `browser`        | the browser-only files: the store contract on IndexedDB and SQLite over OPFS, the engine workers, the save dialog, `xmlDocument: true`, IndexedDB-specific cases | local                                                                                                                           | once per lot (`npm run test:browser`; `npm run test` runs node then this) |
| `browser-all`    | the whole suite in Chromium                                                                                                                                      | local                                                                                                                           | before a branch merges (`npm run test:browser:all`, CI)                   |
| `perf`           | the benches in Chromium (`*.bench.test.ts`), one file at a time                                                                                                  | local                                                                                                                           | on demand (`npm run test:perf`)                                           |
| `perf-node`      | the benches that measure in node: the XML assertions on a generated 5 MB file (parse + one query under 200 ms)                                                   | -                                                                                                                               | on demand (`npm run test:perf:node`)                                      |

The browser-only files, the node-only ones and the node benches are listed in `vitest.config.constants.ts`, each with what it needs; a listed file that no longer exists fails the config. A test that passes in one tier and fails in the other is a bug of a store or of an assertion, never a reason to move it to the browser list.

### Teardown

- `runTestCases` destroys the project of each case.
- `createTestProject` called inside a running test (its body or a `beforeEach`) destroys its project when that test ends, after every other `onTestFinished` hook of the test, whenever that hook was registered: a wrapper's own teardown still finds the project open. Called outside one (`beforeAll`, module scope), the project is the caller's to destroy (`afterAll(() => project.destroy())`, or a cleanup the `beforeAll` returns: `beforeAll(async () => { project = ...; return () => project.destroy() })`): vitest gives no way to tie a teardown to the suite running a `beforeAll`. A project several tests share is therefore opened in `beforeAll` or at module scope: one opened in a test is gone in the next. So is one a vitest fixture opens (`test.extend`), even with `scope: 'file'` or `'worker'`: the fixture is set up inside the first test that uses it, and its project is destroyed when that test ends. Destroying it yourself as well is harmless. Under `test.concurrent` the end of another test may come first: destroy such projects yourself.
- A `Project` or a store a test builds itself is the test's to destroy - once every other one of its name is closed, or the destroy is refused. Under a fixed name (`open('test')`) a project never destroyed leaves its documents to the next one of that name - in memory for the rest of the test worker, on IndexedDB for the rest of the browser run, across test files: use a new name per test (`crypto.randomUUID()`), or destroy it.
- `createTestContext` given a project's name (no `store`) and its `dialecteId` (a project is its dialecte's and its name's) opens a connection of its own to it: `await closeTestContexts()` closes every such one, before the project is destroyed.

### In node

The in-memory store runs anywhere; the local store needs IndexedDB, given to node by `fake-indexeddb` (`import 'fake-indexeddb/auto'` in a setup file). Export writes text and the XML assertions parse it with libxml2 (WebAssembly, the same engine in node and in a browser), so a runner's cases run in node as they do in a browser; only `project.export({ xmlDocument: true })` answers a page's DOM and needs a browser.

### In-memory projects

For tests that don't need XML import/export but do need a working `Document` instance, a project on `{ type: 'inMemory' }` storage is enough:

```ts
import { Project, TEST_DIALECTE_CONFIG } from '@dialecte/core'

const project = await new Project({
	configs: { test: TEST_DIALECTE_CONFIG },
	storage: { type: 'inMemory' },
}).open(`test-${crypto.randomUUID()}`)

const docId = await project.initEmptyDocument({ name: 'fixture' })
const doc = project.openDocument(docId)

// Full Document API works - queries, transactions, extensions
await doc.transaction(async (tx) => {
	await tx.addChild({ tagName: 'Root' }, { tagName: 'A', attributes: { aA: 'value' } })
})

await project.destroy() // frees the state of its name
```

#### Non-writable placeholder

Use `{ type: 'inMemory', writable: false }` to create a Document that throws on any mutation; it reads empty, even under the name of a project holding data, and never frees that data. Useful for testing UI components that receive a `Document` but should not write during a specific phase:

```ts
const project = await new Project({
	configs: { test: TEST_DIALECTE_CONFIG },
	storage: { type: 'inMemory', writable: false },
}).open('placeholder')

const doc = project.openDocument(docId)
await doc.query.getRoot() // undefined (empty)
await doc.transaction(async (tx) => { ... }) // throws STORE_NOT_WRITABLE (D1007)
```
