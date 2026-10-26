# @dialecte/core API map

A map to find the right existing function, not a signature reference. Confirm the exact signature
in the installed `.d.ts` or the repo before calling. Paths are relative to the core package `src/`.

## Contents

- Entry points
- Project
- Document
- Query
- Transaction
- Records, refs, operations
- Hooks (signatures and rules)
- Extensions mechanism
- Helpers (`@dialecte/core/helpers`)
- Utils (`@dialecte/core/utils`)
- Errors, diagnostics, perf
- Stores
- Easy-to-duplicate list

## Entry points

| Import                   | What is there                                                                                                                                    |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `@dialecte/core`         | Project, Document, Query, Transaction, `defineDialecte`, `createProjectFactory`, stores, XML parse/build, errors, diagnostics, perf, all types   |
| `@dialecte/core/helpers` | record converters, guards, `readAttribute(s)`, `standardizeRecord`, `mergeExtensions`, `stripAttributes`, write-path guards, namespace constants |
| `@dialecte/core/utils`   | attribute rules, definition resolution, xsi:type, namespaces, ordering, `invariant`, `formatXml` / `formatEmbeddedXml`, `saveToDisk`             |
| `@dialecte/core/test`    | `createTestHelpers`, `createTestRunner`, `createTestProject`, XML/XPath assertions, test dialecte, `normalizeUuids`                              |

## Project (`project/project.ts`)

- `open(name)` - must come first; opens the store, hydrates `state.documents`. `close()` is async
  and waits for running imports. `destroy()` deletes the database.
- `importFile(file)` → `{ documentId, fileName, recordCount, diagnostics }` or throws; `import(files)`
  → per-file `{ status: 'imported' | 'failed' }`, never rejects. The import runs inside the store; imports
  are serialised per project; a document being imported is invisible until ready.
- `export({ documentId, indent?, withDatabaseIds?, xmlDocument?, download? })` → `{ file: Blob, filename }`
  (+ `xmlDocument` when asked, page only). The store writes the file without a DOM, so export works in a
  worker and in Node.
- `initEmptyDocument()`, `removeDocument(id)`, `getDocuments()`, `getDocument(id)`,
  `openDocument(id)`, `getDocumentStatus(id)`, `getDocumentConfig(id)`.
- `undo(id)` / `redo(id)` - store-level change log.
- Blobs: `addBlob`, `getBlob`, `exportBlob`, `attachBlob`, `detachBlob`, `removeBlob`,
  `getBlobsByDocument`, `getBlobsByRecord`, `getStandaloneBlobs`. `getDatabaseInstance()` for the raw DB.
- Cross-document: `queryFirst(fn)`, `queryAll(fn)`.
- `state` (documents map), `perf`, BroadcastChannel per project name (multi-tab sync).

## Document (`document/document.ts`)

- `query` - getter, a new Query each access (extensions bound).
- `transaction(fn, { label? })` - callback → `beforeCommit` → atomic commit → broadcast → history.
- `prepare(fn)` → `{ operations, summary, query, commit(), discard() }` - preview before commit.
- `state` (`loading, error, progress, history, lastUpdate`), `subscribe(cb)`, `documentId`.

## Method index (generated from the source)

<!-- dialecte-skills:generated core-methods -->

- Query (`doc.query`, also on `tx`): `findAncestors`, `findByAttributes`, `findDescendants`, `getAttribute`, `getAttributes`, `getChild`, `getChildren`, `getDefinition`, `getDocumentInfo`, `getRecord`, `getRecords`, `getRecordsByTagName`, `getRoot`, `getSnapshot`, `getTree`
- Transaction only (`tx`): `addChild`, `clearRecordCache`, `clearStagedOperations`, `commit`, `deepClone`, `delete`, `ensureChild`, `finishStaging`, `getStagedOperations`, `update`
- Document: `close`, `destroy`, `prepare`, `subscribe`, `transaction`
- Project: `addBlob`, `attachBlob`, `close`, `createChannel`, `destroy`, `detachBlob`, `export`, `exportBlob`, `getBlob`, `getBlobsByDocument`, `getBlobsByRecord`, `getDatabaseInstance`, `getDocument`, `getDocumentConfig`, `getDocumentStatus`, `getDocuments`, `getStandaloneBlobs`, `import`, `importFile`, `initEmptyDocument`, `open`, `openDocument`, `queryAll`, `queryFirst`, `redo`, `removeBlob`, `removeDocument`, `undo`
<!-- /dialecte-skills:generated -->

## Query (`document/query/main.ts`)

| Method                                                                            | Use it for                                                                                                                            |
| --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `getRoot()`                                                                       | the root record                                                                                                                       |
| `getRecord(ref)` / `getRecords(refs)`                                             | one / many records, `undefined` when missing                                                                                          |
| `getChild(ref, tag)` / `getChildren(ref, tag)`                                    | direct children by tag                                                                                                                |
| `getRecordsByTagName(tag)`                                                        | every record of a tag in the document                                                                                                 |
| `findDescendants(ref, { collect, omit })`                                         | descendants grouped by tag (NOT document order)                                                                                       |
| `findAncestors(ref, { depth, stopAtTagName, order })`                             | the ancestor chain (bottom-up by default)                                                                                             |
| `findByAttributes({ tagName, attributes })`                                       | lookup by attribute values                                                                                                            |
| `getTree(ref, { select: { where, ... }, omit, unwrap, depth })`                   | a subtree in document order; unwraps transparent elements by default; whole-document load unless a committed read with `id` + `depth` |
| `getSnapshot({ ref, ancestors, siblings, depth, as: 'tree' \| 'xml' \| 'both' })` | a view with staged ops overlaid                                                                                                       |
| `getAttribute(ref, { name, namespace?, fullObject?, defaults? })`                 | one attribute (`''` when absent)                                                                                                      |
| `getAttributes(ref, { namespace?, fullObject?, defaults? })`                      | value object of attributes                                                                                                            |
| `getDefinition(ref)`                                                              | resolved definition (parent- and xsi:type-aware)                                                                                      |
| `getDocumentInfo()`                                                               | the document's registry record                                                                                                        |
| `any`                                                                             | untyped escape hatch - avoid in domain code                                                                                           |

## Transaction (`document/transaction/main.ts`, extends Query)

| Method                                                               | Use it for                                                                             |
| -------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `addChild(parent, { tagName, attributes, namespace?, value?, id? })` | create; standardised, hooks fire                                                       |
| `ensureChild(parent, params)`                                        | get-or-create among direct children (match by attributes, then id, then tag)           |
| `update(ref, { attributes?, value? })`                               | change; an `undefined`/`null` attribute value removes it; no-op updates stage nothing  |
| `delete(ref)`                                                        | delete with cascade; root is protected                                                 |
| `deepClone(parent, treeRecord)`                                      | copy a `getTree` result under a parent; always new ids; returns source→target mappings |
| `progress`                                                           | `plan`, `nextStep`, `endPlan` for long operations                                      |

`finishStaging`, `commit`, `getStagedOperations`, `clear*` are internal - Document calls them.

## Records, refs, operations (`types/records.ts`, `document/types.ref.ts`, `types/operations.ts`)

- `RawRecord` `{ id, tagName, namespace, attributes[], value, parent: {id, tagName} | null, children[] }`
  (stored shape; a root's `parent` is `null`, not `undefined`).
- `TrackedRecord` = raw + `status` (created/updated/deleted/unchanged) - what queries return.
- `TreeRecord` = tracked + `tree[]` - what `getTree` returns.
- `Ref` `{ tagName, id }` (id optional only for singletons). Methods accept any `RefOrRecord`.
- `Operation`: created(new) | updated(old, new) | deleted(old).
- Attribute forms: value object uses stored names (`'ext:cA'`, `'xsi:type'`); full-object form
  takes a local `name` plus `namespace` - a prefixed name there is rejected.

## Hooks (`types/dialecte-config.ts`, `types/io.ts`)

Provided by the dialecte package (on the Project, built once per project), not by app code in
general. Signatures in the installed `.d.ts`; behaviour:

| Hook                                                                                                              | Receives                               | Returns                                                                                             | Notes                                                                                                                         |
| ----------------------------------------------------------------------------------------------------------------- | -------------------------------------- | --------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `beforeClone`                                                                                                     | `{ record }` (tree)                    | `{ shouldBeCloned, transformedRecord }`                                                             | sync, per node; false drops the subtree                                                                                       |
| `afterStandardizedRecord`                                                                                         | `{ record }`                           | record                                                                                              | sync, idempotent; runs on create, update, import, init                                                                        |
| `afterCreated`                                                                                                    | `{ childRecord, parentRecord, query }` | `Operation[]`                                                                                       | after child + parent staged                                                                                                   |
| `afterUpdated`                                                                                                    | `{ oldRecord, newRecord, query }`      | `Operation[]`                                                                                       | skipped for no-op updates                                                                                                     |
| `beforeDelete`                                                                                                    | `{ record, query }`                    | `Operation[]`                                                                                       | once on the deletion root, subtree still readable                                                                             |
| `afterDelete`                                                                                                     | `{ record, parentRecord, query }`      | `Operation[]`                                                                                       | subtree gone                                                                                                                  |
| `beforeCommit`                                                                                                    | `{ operations, query }`                | `Operation[]`                                                                                       | once per transaction; its ops fire no hooks                                                                                   |
| `beforeImport`                                                                                                    | xml string                             | xml string                                                                                          | whole-file normalisation                                                                                                      |
| `createImportSession` → `beforeImportRecord` (one session per file; `recordTagNames` narrows the records it sees) | `{ record, ancestry }`                 | void                                                                                                | sync, per record at its closing tag (children before parent); `ancestry` = still-open parents, not standardised; collect only |
| `afterImport`                                                                                                     | -                                      | `{ creates, updates, deletes, diagnostics }` (the diagnostics reach the app with the import result) | resolve from collected state; bulk write, no undo                                                                             |

Hook-returned operations skip standardisation, guards and further hooks. A returned `deleted`
needs the parent's `updated` (children list) too.

## Extensions mechanism (`document/types.extensions.ts`, `helpers/merge-extensions.ts`, `document/bind-extensions.ts`)

- A module is `{ query?, transaction? }`, groups nest to any depth.
- `mergeExtensions({ base, custom })` merges per method at Project construction; duplicates throw
  `EXTENSION_METHOD_COLLISION`.
- `bindExtensions` drops the first argument: `fn(query, params)` becomes `doc.query.<ns>.fn(params)`.
- Inside a transaction both query and transaction groups are bound to `tx`.
- Naming an augmented document: `ExtendedDocument<Config, Modules>`; do not hand-write intersections.

## Helpers (`@dialecte/core/helpers`)

- `toRef(recordOrRef)`, `toRawRecord`, `toTrackedRecord`, `toTreeRecord`, `widen`, `toFullAttributeArray`.
- Guards: `isRawRecord`, `isTrackedRecord`, `isTreeRecord`, `isRecordOf`, `isChildOf`, `isParentOf`,
  `isElementOf`, `isAttributeOf`, `isFullAttributeArray`.
- `readAttribute` / `readAttributes` - sync, same options and results as the query methods, on a
  record as held (no staged writes); take `dialecteConfig`. A dialecte package may export a bound
  version - prefer it.
- `standardizeRecord`, `stripAttributes`, `mergeExtensions`.
- Write guards: `assertNoFixedViolation`, `assertXsiTypeAdmitted`, `assertXsiTypeChangeLeavesNothing`.
- Constants: `CUSTOM_RECORD_ID_ATTRIBUTE` (`dev:db-id`), `DIALECTE_DEV_NAMESPACE`, `XSI_NAMESPACE`, ...

## Utils (`@dialecte/core/utils`)

- `invariant(condition, { detail, key?, ref?, meta? })`.
- Attribute rules: `getAttributeRules`, `resolveSchemaAttributeValue`, `isSchemaDefaultValue`, `extractLocalName`.
- Definitions: `resolveDefinition(record)` (needs a record; for a ref use `query.getDefinition`),
  `admittedXsiTypes`, `resolveXsiType`, `canonicalXsiType`.
- Datatypes: `enumeratedValues`, `valuePatterns`.
- Namespaces: `resolveNamespaceByPrefix`, `resolveNamespaceByScope`, `resolvePrefixByNamespaceScope`,
  `compareQualifiedAttributes`, `orderAttributesBySequence`, `isNamespaceAllowedByWildcard`.
- Ordering: `orderByConfigSequence`.
- XML text: `formatXml` (template-tolerant, for fixtures), `formatEmbeddedXml` - only from
  `@dialecte/core/utils`; the main entry has no `formatXml` (`project.export` formats its file).

## Errors, diagnostics, perf

- `throwDialecteError(key, { detail, ref?, meta?, cause? })`, `createDialecteError`, `toDialecteError`,
  `isKnownDialecteError(err, { catalogues })`, `defineErrors(catalogue)` for a dialecte's own codes.
- Core codes by range: D0 general, D1 store, D2 records, D3 constraint violations, D4 transaction,
  D5 IO, D6 config (extension collision), D7 project.
- Diagnostics (import warnings, validation): `createDiagnostic(catalogue, code, { ref, meta })`,
  `isKnownDiagnostic`. LSP-shaped `{ code, severity, source, message, ref }`.
- Perf: `dev: { perf: true }` on project creation (when the package factory accepts `dev`; check its signature); `perf.start/stop/count/time/report()`; marks are
  `dialecte::<layer>::<name>` on the standard performance timeline.

## Stores (`store/`)

- `storage` param: `{ type: 'local' }` (IndexedDB), `{ type: 'inMemory', writable? }`,
  `{ type: 'custom', store }`. The store is a switch: results must be identical on every store,
  only speed changes. A difference is a store bug.
- `Store` interface is public surface for custom stores. The patch merge every built-in store uses
  is internal to the stores (not exported): a custom store merges a `RecordPatch` itself.

## Easy-to-duplicate list - grep these before writing

ref conversion `toRef` · record shapes `toRawRecord`/`toTreeRecord`/`widen` · attribute reads
`getAttributes`/`readAttributes` · lookup by attributes `findByAttributes` · canonical order
`orderAttributesBySequence`/`orderByConfigSequence` · definition `getDefinition`/`resolveDefinition`
· xsi:type `canonicalXsiType` · namespaces `utils/namespaces.ts` · errors `invariant`/`throwDialecteError`
· diagnostics `createDiagnostic` · binding `bindExtensions` ·
subtree copy `getTree` + `deepClone` (but check the dialecte for a faithful domain copy first) ·
XML text `formatXml`.
