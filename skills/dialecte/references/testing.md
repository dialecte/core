# Testing with Dialecte

Every dialecte package ships table-driven runners built on core's `createTestRunner`. Use them;
do not hand-roll project setup, import, export and cleanup in each test.

| Package                        | Import                     | Runner                                                                                                                |
| ------------------------------ | -------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| core (its dummy test dialecte) | `@dialecte/core/test`      | `createTestHelpers({ dialecte })` → `runTestCases`, `createTestProject`, ...; the dummy dialecte's own `runTestCases` |
| a dialecte package             | `<package>/<version>/test` | `run<Name>TestCases`, `create<Name>TestProject`, ... (see that dialecte's skill)                                      |

## The three modes

- `.withExport({ testCases, act })` - the outcome is XML. `act` performs the write and may return
  `{ assertOn: 'source' | 'target', withDatabaseIds? }` (default: source, ids kept) or
  `{ assertOn: 'custom', xmlString }`; each case lists `expectedQueries` / `unexpectedQueries`.
  XPath prefixes are the config's namespace KEYS, not the XML prefixes: `default:` for the default
  namespace, the config key for every other one.
- `.withoutExport({ testCases, act })` - the outcome is a value or a call. `act` asserts with
  `expect` itself and returns nothing.
- `.generic(testCases, act)` - pure synchronous functions, no XML, no database.

## Shape

```ts
// core's own tests, on its dummy schema (Root > A > AA_1 > AAA_1, required attributes aA, aAA_1, ...)
import { CUSTOM_RECORD_ID_ATTRIBUTE } from '@dialecte/core/helpers'
import { XMLNS_DEFAULT_NAMESPACE, XMLNS_DEV_NAMESPACE, runTestCases } from '@dialecte/core/test'

import type { ActParams, ActResult, BaseXmlTestCase, TestDialecteConfig } from '@dialecte/core/test'

type TestCase = BaseXmlTestCase & { params: { value: string } }

const testCases: Record<string, TestCase> = {
	'A without AA_1 → AA_1 added with the value': {
		sourceXml: /* xml */ `
			<Root ${XMLNS_DEFAULT_NAMESPACE} ${XMLNS_DEV_NAMESPACE} ${CUSTOM_RECORD_ID_ATTRIBUTE}="root">
				<A ${CUSTOM_RECORD_ID_ATTRIBUTE}="a-without-child" aA="one" />
				<!-- no AA_1 yet -->
			</Root>`,
		params: { value: 'added' },
		expectedQueries: ['//default:A[@aA="one"]/default:AA_1[@aAA_1="added"]'],
	},
}

async function act({
	testCase,
	source,
}: ActParams<TestDialecteConfig, TestCase>): Promise<ActResult> {
	await source.transaction(async (tx) => addFirstChild(tx, testCase.params))
	return { assertOn: 'source' }
}

runTestCases.withExport({ testCases, act })
```

A dialecte package's runner has the same shape with its own types (`<Name>Test.TestCases`,
`<Name>Test.ActParams`) and its root element.

## Rules

- **Red first, one case at a time.** Add one case with `only: true`, run it, see it fail for the
  right reason (an assertion, not a missing module - stub the function with the right type first),
  write the minimum code, then the next case. Remove every `only` at the end. A table written after
  the implementation only pins what the code happens to do.
- **Case keys** read `<initial state> → <outcome>`.
- **Fixtures are inline XML** in the test file. `dev:db-id` (`CUSTOM_RECORD_ID_ATTRIBUTE`) gives
  records stable ids; choose ids that say intent (`orphaned-ref`, `a-without-child`). Comment the
  elements that are deliberately absent. No `<?xml ?>` declaration in template literals.
- **Expectations are structural XPath with meaningful predicates.** `//default:AA_1` alone proves
  nothing; a case can pass because ANOTHER element matched. Do not assert on `dev:db-id` in XPath.
  Pair `unexpectedQueries` with the commented-out source when asserting a deletion.
- **Fixtures are validated against the schema before a case runs** by the runners `createTestHelpers`
  builds - every dialecte package's `run<Name>TestCases` / `create<Name>TestProject` (a dialecte may
  add its own checks, see its skill). Opt out of those extra checks only with a written reason
  (`skipExtraChecks: '<why>'` on `createTestProject`). Core's own `runTestCases` on the dummy
  dialecte (`createTestRunner`) validates nothing.
- **Test the function directly** (`fn(source.query, params)` / `fn(tx, params)`), not through the
  bound extension method. Use public interfaces; no mocks of internal collaborators.
- **No test names its store: the runner chooses it.** A node vitest project whose setup file calls
  `useTestStorage({ type: 'inMemory' })` (core 0.8+) runs your tests in Node on the in-memory store;
  without one, the runner's default store. A second project whose setup imports
  `@dialecte/core/sqlite` and calls `useTestStorage({ type: 'sqlite' })` (core 0.8+) runs the same
  suites on the SQLite engine in the test's own process, no test changed. A test file never calls `useTestStorage` and passes no
  `storage`; only a test about one store itself (an IndexedDB-only behaviour) names it. The
  interface is the truth: a result that differs per store is a store bug, never a reason to pin one
  store.
- **XML assertions take XML text.** `expectedQueries`, `assertOn: 'custom'` (`xmlString`), and the
  `assertExpectedElementQueries({ xml, queries })` / `assertUnexpectedElementQueries({ xml, queries })`
  that `createXmlAssertions({ namespaces })` returns, read a string, the same way in Node and in the
  browser. Holding a DOM? Serialize it first. Never build one for a test (`xmlDocument: true`,
  `DOMParser`, `document.evaluate`): they exist only in the page.
- **XPath for small exact output, record expectations for big files.** On a fixture of megabytes, a
  `//` query over the whole export takes seconds and its failure prints too much. State what must
  hold as record expectations - a tag, attribute values, the parent, a count - and check them on
  the records in `.withoutExport`, with the query API:

  ```ts
  // .withoutExport: the expectations read the records, no export, no XPath
  async function act({ testCase, source }: ActParams<Config, TestCase>): Promise<void> {
  	await source.transaction(async (tx) => renameParts(tx, testCase.params))
  	const root = await source.query.getRoot()
  	const { Part = [], Assembly = [] } = await source.query.findDescendants(root, {
  		collect: ['Part', 'Assembly'],
  	})
  	expect(Part).toHaveLength(3) // count
  	for (const assembly of Assembly) {
  		const parent = await source.query.getRecord(assembly.parent) // the parent
  		expect(parent?.tagName).toBe('Line')
  	}
  }
  ```

- **Green by accident** is the classic trap: last-wins indexes, id order, an XPath matching a
  sibling. When a case passes on the first run, break the code on purpose and watch it fail.
- Re-indent `/* xml */` fixtures with core's `dialecte-xmlfmt "<glob>"`; the code formatter does not
  touch them.
