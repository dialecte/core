# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## UNRELEASED

## [0.2.11] - 2026-05-21

### Fixed

- export: only strip empty + optional + non-identity attributes (previously stripped all attributes matching schema default)

### Changed

- test XSD: removed non-conventional `dBB_1`/`eBB_1`/`fBB_1` attributes; distributed defaults across `bBB_1`, `bBB_2`, `bBBB_1` per a/b/c naming convention

## [0.2.10] - 2026-05-19

### Changed

- `createTestRunner` now accepts a single object param: `{ dialecteConfig, hooks?, extensions? }`
- `createTestProject` accepts `extensions?: { base?, custom? }` to produce fully-hydrated projects with extension modules
- `TestProjectResult`, `ActParams`, and `TestRunner` carry a `GenericModules` generic - project type flows through to `act` callbacks

## [0.2.9] - 2026-05-19

### Changed

- `ActParams` now includes `project` - the `Project` instance is passed to `act` callbacks in `runTestCases.withExport` and `runTestCases.withoutExport`s `act` callbakc has now

## [0.2.8] - 2026-05-18

### Changed

- `DocumentActivity` renamed to `DocumentState` (document-internal; lives on `doc.state`)
- `DocumentState` (project-level) renamed to `DocumentEntry` (`DocumentState & { record, canUndo, canRedo }`)
- `DocumentEntry.document` renamed to `DocumentEntry.record`

## [0.2.7] - 2026-05-13

### Added

- handle `cdata` via the xml parser

## [0.2.6] - 2026-05-12

### Added

- `project.queryFirst(fn)` - cross-document query; iterates documents sequentially, returns first non-undefined result
- `project.queryAll(fn)` - cross-document query; iterates all documents, returns flattened results

### Changed

- `project.import(file)` now accepts `files: File[]` for batch import; returns `Array<{ documentId, recordCount }>`

## [0.2.4] - 2026-05-11

### Added

- `Project` class: multi-document container owning the store, config registry, and BroadcastChannel
  - `new Project({ configs, storage, defaultConfigKey?, extensionsRegistry?, hooks? })` - sync constructor, config only
  - `project.open(name)` - async, opens DB connection, hydrates state; returns `this` for chaining
  - `project.import(file)`, `project.export(documentId)`, `project.initEmptyDocument()`
  - `project.openDocument(documentId)` - returns a file-scoped `Document`
  - `project.getDocument(documentId)`, `project.getDocuments()`
  - `project.undo(documentId)`, `project.redo(documentId)`
  - `project.close()`, `project.destroy()`
  - `project.getDatabaseInstance()` - exposes the native DB instance; return type inferred from store generic
- `Store` interface: file-partitioned operations with file registry, bulk writes, file-scoped history
- `DexieStore`: partitioned tables (`xel_{fileId}`) with dynamic schema versioning; implements `getDatabaseInstance(): Dexie`
- `RecordSchema` type: backend-agnostic index declaration
- `Document.fileId` / `Context.fileId`: all operations scoped to a file partition
- `DocumentRecord`, `DocumentState`, `ProjectState` types
- `exportDocument`, `importDocument`, `initEmptyDocument` - pure IO functions usable outside Project
- `ParseSession` class: parent-child tracking during SAX parsing
- Error codes: `D5001`, `D5002`, `D7001 UNKNOWN_CONFIG_KEY`, `D7002 DOCUMENT_NOT_REGISTERED`, `D7003 PROJECT_NOT_OPENED`
- Test infrastructure: `createTestProject` - spins up a Project with source/target files imported

### Changed

- `ProjectParams` replaces `ProjectOpenParams` - `name` removed from constructor, moved to `open(name)`
- Pre-open fields (`name`, `store`, `channel`) guarded by getters; throw `PROJECT_NOT_OPENED` if accessed before `open()`
- `Document`, `Query`, `Transaction` constructors require `fileId`; BroadcastChannel messages filtered per file
- `DatabaseConfig.recordSchema` replaces `tables`
- `DocumentState` renamed to `DocumentActivity` (document-internal); `DocumentState` reused at project level as `DocumentActivity & { document, canUndo, canRedo }`
- IO exports split: `buildXmlDocument`, `downloadFile`, `parseXmlFile`, `ParseSession` exported individually
- Test helpers: `ActResult.assertOn` replaces `assertDatabaseName`; `ActParams.source`/`target` are `Document` instances
- Type files redistributed by DDD boundary

### Removed

- `openDialecteDocument`, `createDialecteDocument` - replaced by `Project`
- `importXmlFiles`, `exportXmlFile` - replaced by `project.import` / `project.export`
- `Document.undo()` / `Document.redo()` - moved to `Project.undo(documentId)` / `Project.redo(documentId)`
- `database-helpers.ts`, `relationships.ts` - absorbed into `ParseSession` and `DexieStore`

## [0.1.22] - 2026-05-07

### Added

- `transparentElements` config field: list of element names treated as transparent wrappers during read operations
  - `getChild` and `getChildren` automatically look through transparent elements when no direct match is found
  - direct children always win (fast path); transparent lookup only triggers on miss
  - `Context` now carries `dialecteConfig` to make this available to FP query functions

## [0.1.21] - 2026-05-04

### Added

- `query.any` namespace (`AnyQuery`): full read surface without `ElementsOf`/`ChildrenOf` constraints - for custom/private elements (`xs:any`), dynamic tag names, or call sites where the element type is unknown
  - mirrors all public `Query` methods: `getRecord`, `getRecords`, `getChild`, `getChildren`, `getRecordsByTagName`, `getAttribute`, `getAttributes`, `getTree`, `findAncestors`, `findDescendants`, `findByAttributes`
  - accepts `string` for tag names, `Record<string, string>` for attributes
  - accessible via `doc.query.any`
- `transaction.any` namespace (`AnyTransaction`): extends `query.any` with untyped mutation methods
  - `addChild`, `ensureChild`, `update`, `delete`, `deepClone`
  - accessible via `tx.any` inside `doc.transaction()`

### Changed

- `query.getAnyAttribute`, `query.getAnyAttributes`, `query.getAnyChild`, `query.getAnyChildren` removed - replaced by `query.any.getAttribute`, `query.any.getAttributes`, `query.any.getChild`, `query.any.getChildren`

## [0.1.20] - 2026-04-30

### Changed

- `getTree`: auto-recursion for self-recursive elements - core detects when an element can contain itself and recurses automatically without explicit `recursive: true`

## [0.1.19] - 2026-04-30

### Changed

- `omit` entries in `getTree` and `findDescendants` now use key-based syntax: `{ TagName: { where?, scope? } }` instead of `{ tagName: 'TagName', where?, scope? }`
- `findDescendants`: `omit` upgraded from plain `string[]` to shared `OmitEntry[]` - supports conditional exclusion with `where` filters

## [0.1.18] - 2026-04-30

### Added

- `query.findDescendants(ref)` overload (no options): collects all descendant tag names from dialecteConfig. Returns `Partial<Record<DescendantsOf<Config, E>, TrackedRecord[]>>`

## [0.1.17] - 2026-04-29

### Changed

- `getTree`: new Prisma-style options - `select` (typed nested object to pick branches), `omit` (string or conditional with `where`/`scope`), `unwrap` (flatten intermediary tagNames)
- `findDescendants`: new `collect` + `omit` API replacing recursive linked-list filter:
  - `collect: string` - single tagName at any depth
  - `collect: array` - multiple tagNames with optional `where` filters
  - `collect: object` - path-aware nesting order
  - return type inferred from `collect` value - typed destructurable `{ [tagName]: TrackedRecord[] }`
  - optimized for large files: indexed bottom-up ancestry (flat mode), pre-filtered level-order traversal (path mode)

## [0.1.16] - 2026-04-24

### Added

- `identityFields` on element definition: precomputed list of attribute names participating in XSD identity constraints (unique/key), derived at generation time
- export: `shouldSkipDefaultAttribute` guard strips optional attributes matching their schema default, unless they participate in identity constraints

### Fixed

- `standardizeRecord`: `||` replaced with `??` - optional attributes with empty-string defaults are now correctly preserved during import and record creation

## [0.1.15] - 2026-04-23

### Changed

- `downloadFile`: file picker description now derived from extension - strips leading dot and uppercases (e.g. `.xml` -> `XML Files`)

## [0.1.14] - 2026-04-23

### Changed

- `getAnyAttribute` / `getAnyAttributes`: signature aligned with typed counterparts - accept `{ name, fullObject? }` params object with overloads for value vs full-object return

## [0.1.13] - 2026-04-21

### Added

- simple untyped api entrypoint (`AnyRefOrRecord`):
  - `query.getAnyAttribute(ref, name)`
  - `query.getAnyAttributes(ref)`
  - `query.getAnyChild(ref, tagName)`
  - `query.getAnyChildren(ref, tagName)`

### Changed

- `afterDeepClone` hook: removed `mappings` param - use `cumulativeCloneMappings` (strict superset)
- `CloneMapping.source` now carries `attributes: readonly AnyAttribute[]` - avoids cross-DB record lookup in hooks

## [0.1.12] - 2026-04-20

### Added

- `createDialecteDocument`: async factory that opens a document **and** commits the root element in a single call
- `query.getFilename()`: returns the document's store name (filename)
- guards: `isElementOf` & `isAttributeOf``
- utils: `stripAttribute`

### Changed

- `hooks` rework: to avoid circular dependencies in types and function, they are now passed as a separate parameters like the extensions.
  - removed from `DialecteConfig` / `RawDialecteConfig`
  - `TransactionHooks` is now generic: `TransactionHooks<GenericConfig>`

## [0.1.11] - 2026-04-14

### Changed

- `assert` utility renamed to `invariant` to avoid clashes with other assert functions in consuming projects

## [0.1.10] - 2026-04-14

### Added

- `FindAncestorsOptions.order`: `'bottom-up'` (default) | `'top-down'` — controls result order of `findAncestors`

### Changed

- `TransactionHooks` async hooks (`afterCreated`, `afterDeepClone`, `afterUpdated`, `beforeDelete`): `context: Context<Config>` replaced by `query: Query<Config>`. Use `query.getRecord`, `query.findAncestors`, `query.getRecordsByTagName` directly instead of bare helper functions.

## [0.1.9] - 2026-04-10

### Added

- `TestRunner<Config>`: exported type for `createTestRunner` return value

## [0.1.8] - 2026-04-10

### Added

- `createTestRunner`: factory returning a pre-bound test runner object `{ withExport, withoutExport, generic }`
- `runTestCases`: pre-bound instance of `createTestRunner` for the core test dialecte config

## [0.1.7] - 2026-04-10

### Added

- `afterDeepClone`, `beforeDelete`, `afterUpdated` transaction hooks
- docs: `llms.txt` generation on deploy
- docs: hooks API, IO API pages

### Changed

- extensions merging reworked — custom extensions can now be defined outside a Dialecte library
- migrated all transaction and query tests to `runXmlTestCases` / `runTestCases`
- updated testing documentation (3 scenarios: sync, async void, async ActResult)

## [0.1.6] - 2026-04-01

### Changed

- definition type fix

## [0.1.5] - 2026-04-01

### Added

- `ensureChild`, `findAncestor`, `getChild`, `getChildren`

## [0.1.4] - 2026-03-30

### Added

- `runTestCases`: table-driven XPath test helper

### Changed

- `test-fixtures` folder renamed to `test`
- migrated transaction tests to `runTestCases`
- definition type updated; `RawRecord` returned instead of `Ref` from transaction methods

## [0.1.3] - 2026-03-13

### Added

- Extension system

### Changed

- updated global documentation

## [0.1.2] - 2026-03-11

### Added

- JSDoc with `@param`, `@returns`, and `@example` on all public `Query` and `Transaction` methods

### Changed

- `findDescendants` filter type: reduced max nesting depth from 20 to 8 to improve TypeScript language server performance

## [0.1.1] - 2026-03-11

### Changed

- packages update (npm audit)

## [0.1.0] - 2026-03-11

### Added

- Reboot: replaced the chain-based API (`chain-methods`) with an explicit `Document` / `Query` / `Transaction` model
  - `doc.query` — read-only interface: `getRoot`, `getRecord`, `getRecords`, `getRecordsByTagName`, `findDescendants`, `getTree`, `getAttribute`, `getAttributes`
  - `doc.transaction(async (tx) => { ... })` — scoped write unit: `addChild`, `update`, `delete`, `deepClone`, `commit`
  - `doc.prepare(...)` — deferred transaction: returns a `{ commit }` handle for user-triggered writes
  - `doc.undo()` / `doc.redo()` / `doc.destroy()` — document lifecycle methods
- `helpers` and `utils` are no longer re-exported from the main `@dialecte/core` entry point; import them from `@dialecte/core/helpers` and `@dialecte/core/utils`
- `errors` and `store` are exported from the main `@dialecte/core` entry point

## [0.0.21] - 2026-03-03

### Added

- `createXmlAssertions`: factory exported from `@dialecte/core/test`. Intended to be instantiated once in a dialecte's test-fixtures and re-exported alongside `createTestDialecte`. Returns:
  - `assertExpectedElementQueries`: asserts each XPath query matches at least one element, with step-level diagnostics showing which segment failed and the last successfully matched element
  - `assertUnexpectedElementQueries`: asserts each XPath query matches no element; for multi-step queries, verifies all ancestor steps exist first to prevent false positives from broken test setup

### Changed

- test-fixture utilities are no longer re-exported from the main `@dialecte/core` entry point but `@dialecte/core/test`

## [0.0.20] - 2026-03-02

### Changed

- `update` method: passing `undefined` or `null` as an attribute value now removes that attribute from the record — it will no longer appear in the XML output

## [0.0.19] - 2026-02-24

### Changed

- allow file export with database ids

## [0.0.18] - 2026-02-24

### Changed

- dependencies update

## [0.0.17] - 2026-02-24

### Changed

- `createDialecte` is now synchronous — root element creation is deferred to the first `fromRoot()` call

## [0.0.16] - 2026-02-17

### Fixed

- `goToElement`: we do not get the last state with updated element for singletons (element without id)
  -> fetch last staged operations for every element before database

## [0.0.15] - 2026-02-16

### Added

- `findDescendantsAsTree`: wrapper around `findDescendants` to get a tree record instead of a flatten result
- testing `pyodide` for the generation script - still wip

### Changed

- `findDescendants`: in between elements are optional if not specified with attributes, and collected if present

### Fixed

- `create` method hook integration: set the focus on the right updated parent

## [0.0.14] - 2026-02-02

### Changed

- extract `extensions` from the configuration to avoid circular type references issues
- expose tagName explicitly in the core methods, to expose the right methods in the chain at runtime

## [0.0.13] - 2026-02-02

### Changed

- allow partial attribute on `update` method (globally)

## [0.0.12] - 2026-02-02

### Changed

- `FindDescendantsReturn`: narrow down unfiltered `findDescendants` results

## [0.0.11] - 2026-02-02

### Added

- `AnyTreeRecord` type

### Fixed

- right chain ending focus on `deepCloneChild` with setFocus parameter

## [0.0.10] - 2026-01-30

### Fixed

- `beforeClone` hook implementation in the `deepCloneChild` method

## [0.0.9] - 2026-01-30

### Added

- `beforeClone` hook added to the clone method

## [0.0.8] - 2026-01-30

### Added

- `getAttributesValues`: new chain method to get currentFocus attributes values

## [0.0.7] - 2026-01-29

### Changed

- allow partial attribute on `update` method

## [0.0.6] - 2026-01-29

### Added

- `withDownload` parameter on `exportFile` with native Api support and fallback to be able to download a file

## [0.0.5] - 2026-01-29

### Changed

- export `ExtensionMethods` type

## [0.0.4] - 2026-01-28

### Added

- io: select an extension from the `supportedExtensions` list of the `dialecteConfig` at file export.

### Changed

- `xmlElements` in favor of `sclElements` for the `xmlElements` tableName in the `dialecteConfig` (legacy support reasons)

## [0.0.3] - 2026-01-28

### Fixed

- add proper type narrowing support to findDescendants
- fix the tests

## [0.0.2] - 2026-01-28

### Added

- add pipelines to lint, format, check, publish and tag

## [0.0.1] - 2026-01-28

### Added

- methods: chainable (mutations and navigation) and non chainable (endings)
- database: create a Dexie database instance (indexedDB)
- io: file import and export to IndexedDB
- dialecte: create a new core dialecte
- script: generate definition and split it up to constants based on XSD
