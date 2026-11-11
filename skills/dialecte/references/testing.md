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

A test is read far more often than it is written: by the reviewer, by the next person who changes the code,
by whoever reads a failure. Every rule below keeps one case readable on its own and keeps each behaviour proven
in exactly one place.

### The table

- **Red first, one case at a time.** Add one case with `only: true`, run it, see it fail for the
  right reason (an assertion, not a missing module - stub the function with the right type first),
  then the next case. Remove every `only` before the red is recorded (`dialecte tdd red` refuses a
  focused file), then write the minimum code. Record per case where it failed (`<case title>: failed on
  <assertion>`); a case that never failed is listed with its reason (existing behaviour the change
  touches). A table written after the implementation only pins what the code happens to do.
- **One table per behaviour.** `.withExport` with `expectedQueries` when the outcome is XML;
  `.withoutExport` only for a returned value or warnings; a refusal's table runs `.withExport` (see
  Refusals below). A case field that picks which assertions run (`check: 'children' | 'references'`,
  `if (testCase.setup === 'x')`) means two behaviours share a table: split it. A flag marking the
  refusal cases of a table is fine.

  ```ts
  // BAD: one table, the case picks what the act checks
  if (testCase.check === 'children') expect(children).toHaveLength(1)
  else expect(references).toEqual([])

  // GOOD: one table per behaviour, the same act for every case of a table
  runTestCases.withExport({ testCases: addsChildCases, act: addsChildAct })
  runTestCases.withExport({ testCases: keepsReferencesCases, act: keepsReferencesAct })
  ```

- **Case keys** read `<initial state> → <outcome>`. No plan, round, station or ticket tags in titles
  or file names (`round 2`, `step 3`, an issue number).
- **Only the behaviour the change touches.** No preservation cases for code the change leaves alone.
  Each case is written once, for the Node tier; no browser copy of a case. The package's whole-suite
  runs on other tiers or stores are its gate, not duplicates.
- **Readable size.** Aim for 200-300 lines per test file, one verb or behaviour per file. A file
  growing past that holds two behaviours: split it by behaviour, not by line count.

### One call of the unit

A verb's test proves that verb's behaviour, nothing else. The `act` makes **one call of the unit under
test** - the function itself (`fn(tx, params)`, `fn(source.query, params)`) or its bound method
`tx.<ns>.<verb>`; either is one call, never both in one test - then returns or asserts the outcome.

- No second or third call, no retry, no loop over the call.
- No capture before the call: no snapshot of the staged operations, no copy of the document's metadata,
  to compare after. The outcome is what the call left: `expectedQueries`, a returned value, a staged
  list compared with a literal. "Unchanged" is a case of its own only where it is the behaviour.
- No XPath on the source inside the `act`, no branch on the case.
- Not in a verb's test: the transaction's rollback, source-document purity, id or date formats, timestamps,
  provenance details. Their owners test them (core's transaction, the writer of the timestamp, schema
  validation, one acceptance case for source purity); a verb re-proving them breaks when the owner
  changes, not when the verb does.
- A **reshape** keeps every behaviour covered **by the test that owns it**. List each check it removes
  with the test that covers it, and open that test: it must really assert it, or the reshape adds the case
  there first.

```ts
// BAD: a state captured before the call, compared after it
const before = structuredClone(await source.query.getDocumentInfo())
await source.transaction(async (tx) => addFirstChild(tx, testCase.params))
expect(await source.query.getDocumentInfo()).not.toEqual(before)

// GOOD: one call; the case's expectedQueries carry the outcome
async function act({
	testCase,
	source,
}: ActParams<TestDialecteConfig, TestCase>): Promise<ActResult> {
	await source.transaction(async (tx) => addFirstChild(tx, testCase.params))
	return { assertOn: 'source' }
}
```

### Refusals assert outcomes, never spies

A refusal is proven by what it leaves: the error key, nothing staged, the documents unchanged.

- Catch the refusal inside its transaction, assert its key, then `tx.getStagedOperations()` equal to
  `[]`, still inside that transaction.
- Run the table `.withExport` so the source's `expectedQueries` show the document unchanged.
- No `vi.spyOn` on a transaction or query method: a spy tests how the code writes, and passes while the
  document is wrong.

```ts
// BAD: a spy on how it writes
const addChild = vi.spyOn(tx, 'addChild')
await expect(addFirstChild(tx, params)).rejects.toThrow()
expect(addChild).not.toHaveBeenCalled()

// GOOD: the key, nothing staged, the document checked by expectedQueries
await source.transaction(async (tx) => {
	await expect(addFirstChild(tx, testCase.params)).rejects.toMatchObject({
		cause: { key: 'ELEMENT_NOT_FOUND' },
	})
	expect(tx.getStagedOperations()).toEqual([])
})
return { assertOn: 'source' }
```

### Real records, no fakes

- Test through the public interfaces: no mocks of internal collaborators, no hand-written fake `Query`,
  no mock of a query module.
- A step that reads real records gets one real-engine case asserting the values it read, before any
  mock is considered.

### Fixtures are whole documents

Each case's document is written out in full, so a reader sees the exact input without assembling it in
their head, and holds only the elements the case needs.

- **In the test file** (inline in the case, or one file-level constant used whole) when it is at most
  **40 lines**. Above, a sibling file
  `fixtures/<what-it-holds>.xml` read with a static `?raw` import. A fixture file is at most **120 lines**
  and its name says what it holds (`a-with-two-aa-1.xml`, not `fixture2.xml`).
- **A variant is its own document**, never a copy edited at runtime: no `.replace()` on a fixture, no
  shared XML constant spliced into a case's document (`${CHILDREN}`, `${HEADER}`), no fixture builder
  functions, no `*.test-fixtures.ts` module. Substitutions inside a tag are fine: names (`${ns}`),
  attribute values (`aA="${UUID}"`), namespace declarations. A shared empty target is fine.
- A case reading a fixture file carries **one comment** naming what matters in that document
  (`// A "one" holds no AA_1; A "two" holds one without bAA_1`).
- `dev:db-id` (`CUSTOM_RECORD_ID_ATTRIBUTE`) gives records stable ids; choose ids that say intent
  (`orphaned-ref`, `a-without-child`). Comment the elements that are deliberately absent. No
  `<?xml ?>` declaration in template literals.

```ts
// BAD: assembled from pieces
sourceXml: `<Root ${XMLNS_DEFAULT_NAMESPACE}>${A_WITH_CHILDREN.replace('aA="one"', 'aA="two"')}</Root>`,

// GOOD: the whole document, inline or as its own file
import aWithTwoAa1 from './fixtures/a-with-two-aa-1.xml?raw'
// A "one" holds two AA_1; the second has no bAA_1
sourceXml: aWithTwoAa1,
```

**Making a variant: a throwaway script, never calls in the test.**

1. Start from `dialecte fixture <Tag>` (the smallest valid document holding the tag) or an existing whole
   fixture.
2. Write the variant with a throwaway script:
   `dialecte run make-<what>.ts --in <base>.xml --out fixtures/<what-it-holds>.xml --seed <n> --now <iso>`
   (seed and clock fixed, so the same command gives the same file). The script may use any tested
   feature, the verb being changed included: its current output is a valid starting document.
3. Check the result: valid against the schema, and `--expect <file>` (a JSON array of
   `{ tag, where?, under?, count? }`) for what the case needs the document to hold.
4. Commit only the `.xml`. The script is never committed, and never thrown away before the review
   either: a fixture whose making cannot be rerun cannot be reviewed. Keep it with the change's
   hand-over notes (the folder handed to the reviewer) as `fixture-scripts/make-<what>.ts`, listed in
   `fixture-scripts.md` (`| fixture | script | command |`), and delete it with the notes once the change
   lands. A document written whole by hand needs no script; say so on its line.

### Expectations are written by hand

- **Expectations are structural XPath with meaningful predicates**, written in the test file from the
  requirement. `//default:AA_1` alone proves nothing; a case can pass because ANOTHER element matched.
  Do not assert on `dev:db-id` in XPath. Pair `unexpectedQueries` with the commented-out source when
  asserting a deletion.
- **Never generated.** For a document outcome, a document produced by the code under test is never
  the expected result: comparing an export with a saved `.xml` is a snapshot in disguise, it passes on
  whatever the code did the day it was saved.

```ts
// BAD: the code's own output as the truth
expect(exported).toBe(expectedAfterAddXml)

// GOOD: what the requirement says, as queries
expectedQueries: ['//default:A[@aA="one"]/default:AA_1[@aAA_1="added"]'],
```

### The runner and the assertions

- **Fixtures are validated against the schema before a case runs** by the runners `createTestHelpers`
  builds - every dialecte package's `run<Name>TestCases` / `create<Name>TestProject` (a dialecte may
  add its own checks, see its skill). Opt out of those extra checks only with a written reason
  (`skipExtraChecks: '<why>'` on `createTestProject`). Core's own `runTestCases` on the dummy
  dialecte (`createTestRunner`) validates nothing.
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
