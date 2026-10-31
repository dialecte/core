# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## UNRELEASED

### Added

- The origin's hub, `connectHub({ spawners? })`, `createHubPort()` and `adoptHubPort({ port })`: a SharedWorker through which every tab, window and iframe of an app will share one engine per project once the engine is a storage option of `Project` (no store reaches it yet). It elects the view hosting each project's engine worker, hands every other view a port to it, and elects another host when that view goes away. `connectHub` answers the page's connection (the same one for every call and every copy of the library of the same protocol), or `undefined` where the browser has no SharedWorker or the hub never welcomed the page; a spawner whose engine worker is of another origin is left out. A child view that cannot reach the hub's script (another origin) joins through a port its page makes, `createHubPort()`, whose `unbind()` tells the hub it is gone. A page that freezes or enters the back/forward cache lets its engines go and joins again as a new realm when it comes back; its children are dropped with it and refuse their calls `STORE_ENGINE_LOST` (`meta.reason: 'realm-dropped'`) until bound again: `HubRealm.onRejoined(listener)` is called each time the page is welcomed back (never on its first welcome; it answers its unsubscribe), the page makes each child a new port there, and `adoptHubPort` with it joins the same connection again, its projects kept. A port handed before the child was dropped is kept for that moment, and one handed while the child's first join fails becomes its next join. The docs' Dialecte declaration page has a section on it.
- The `dialecte-lot` skill gives every agent and command the orchestrator runs in the background a deadline when it launches it: the station's deadline (the station-to-tier table in `references/model-tiers.md` now gives each station its usual time and its deadline, about 2-3x usual) or three times a duration measured on earlier runs of the same command; Claude Code arms the check at launch (a scheduled check or a monitor), another host polls at the deadline. At the deadline the orchestrator looks at the run itself (its process tree and CPU time, the agent's last activity, `dialecte runs` once the cli has it) instead of waiting on a completion notice that a hung run never sends; it stops a run on what it sees (no new output and no CPU time gained), never on the clock: a run still working past a second deadline is reported as over budget, and under `dialecte handover run`, `gate` and `tdd` the runner's stall watchdog does the kill, the deadline being the backstop. A hand-written commit or merge script in a hand-over is a review finding (hand-overs go through `dialecte handover`); a heavy commit hook is rehearsed while another suite loads the machine, or the hand-over notes the load at rehearsal time. The fix-mode brief adds the never-`git stash` rule the other briefs carry. `dialecte-contributing`: a test that reads the disk, spawns a process or measures time carries an explicit, named bound several times what it takes on a quiet machine (core's `SOURCE_SCAN_TIMEOUT_MS`), and the test review and the review check that every such test has one. New eval cases: `deadline-on-every-background-run`, `scan-test-bound-under-load`, and `review-flags-hand-written-script` as a regression guard.
- `XML_CHARACTER_NOT_ALLOWED` (`D3012`): what a write answers when a record holds a character XML does not allow - a control character below U+0020 but tab, line feed and carriage return, U+FFFE, U+FFFF - in what the writer copies into a file: its value, namespace URI, attribute values and namespace URIs, tag name, namespace prefix, attribute names and prefixes - and, by the export of a file written with the database ids only, its id. (Whether a name is otherwise a valid XML name is not checked.) A transaction (`addChild`, `update`, every write it stages, its hooks' included) and an import session's own writes are refused with it, nothing written; an export (`exportFile`, `project.export`, `getSnapshot({ as: 'xml' })`) of a record already holding one is refused with it, no file. `meta`: `recordId`, `tagName` (when the write names it), `attribute` (its name, when in an attribute), `part` (`'value'`, `'namespace'` for a namespace URI, `'name'`, `'prefix'`, `'id'`), `character` (`U+000B`).
- The `dialecte` and `dialecte-contributing` skills teach the two test tiers: a new test runs in Node on the in-memory store unless it needs a browser API, and then goes into the declared browser-only list with its reason (an IndexedDB-specific test also into the node store-contract list, which runs it on fake-indexeddb); one file is run with `npx vitest run --project node <path>` (or `--project browser`); the Definition of Done runs `npm run test:node` per step, the browser-only list once per lot and `npm run test:browser:all` once before a branch merges. A difference between the tiers is a store or assertion bug: pinned first by a red case in the store contract or beside core's assertion helper, never hidden by moving the test to the browser. No test names its store: the runner chooses it (in Node on the in-memory store under a node vitest project whose setup file calls `useTestStorage`). Assertions take XML text; on a big file, a test checks record expectations (tag, attributes, parent, count) with the query API instead of XPath on the whole export. New eval cases cover each rule.
- The `dialecte-lot` and `dialecte-contributing` skills prove the order of the work with `@dialecte/cli`'s `tdd` receipts: per brief step, a test station (own agent, standard tier) writes the tests and `not implemented` stubs from the brief and the existing code and proves them red with `dialecte tdd red`; a test review (strong tier, read-only) reads only the tests against the spec before any code; the implement station (another agent) changes production code only until `dialecte tdd green`, and sends a test it finds wrong back to the test station. The test code is frozen at the red - helpers, fixtures and snapshots included; every `expect(...)` has a matcher; focus markers (`.only`, `only: true`) are removed before the red; an implementer that edited a test undoes its own edit by hand before handing the case back. The skills say what the receipts guarantee and what they only make visible (an agent with a shell can write them; refusals are kept, rollbacks and reds after a green are flagged for the reviewer). A lot that changes no behaviour is declared exempt in `.dialecte/lot.json` (`{ "tdd": "exempt: <reason>" }`, never committed); the review checks the reason against the diff. A single case may be accepted without a red (`"accept"` in the lot file, a reason each; the review checks each one); a snapshot test's snapshot is written before the red; the skills name what the receipts cannot see (a deliberate throw in production, code written first and a red taken at the base state). The tier table and the briefs reference gain the test station and the test review; new eval cases cover the station order, the exemption, a test frozen after red, and red first through `tdd`.
- The `dialecte-lot` and `dialecte-contributing` skills follow `@dialecte/cli`'s hand-over runner and worktree tools: the agent writes only the lots file and runs `dialecte handover`, rehearses with `dialecte handover run <folder> --rehearse` when the repository has a commit hook, and gives the user the card the command printed as the hand-over message; worktrees are made with `dialecte worktree add`, and after a merge `dialecte worktree prune` lists what goes, its commands handed to the user with their `cd` (its `--yes` asks on a terminal); the orchestrator runs `dialecte gate --fast` (hygiene: nothing staged, no stash entry on the worktree's branch, new files declared) after every agent that hands back. `dialecte-contributing` adds two testing rules: a test owns its temporary folder (never the system's temporary folder itself), and a time bound carries slack and measures only the call under test.
- The `dialecte-lot` skill spawns the `dialecte-<station>` agent a host holds (written by `npx @dialecte/cli skills sync` for Claude Code: model and tools set per station, the reviewer unable to edit files), else a sub-agent on the brief's tier; its "Never" list and the implementer brief add `git stash` (shared by every worktree and session) and every git command that writes the index or the tree (`add`, `rm`, `reset`, `restore`, `checkout --`): the base is read with `git show <base>:<file>`.
- The `dialecte-lot` skill sizes each station's agent by **tier** (`fast`, `standard`, `strong`, `frontier`, or no agent for gates and hand-overs) instead of naming a model, with the station-to-tier table and its rules (escalate one tier after a failed round, never down-tier a correctness review); `npx @dialecte/cli models` says which model a tier is. Briefs carry a `Tier:` line, the retro keeps a token ledger per station and the hand-over message gives the user one usage line. `dialecte-contributing` gains "Reading the standard": markdown first, the converted text kept private, and a cross-check by independent readers and an adjudicator for every decision that changes what the engine does or accepts.
- The `dialecte-contributing` and `dialecte-lot` skills send agents to `@dialecte/cli`'s contributor commands: `rules` (the code-rules self-check), `gate --fast` / `gate --full` (the Definition of Done with the real counts), `new verb` (a scaffold in the house style) and `handover` (the guarded commit-by-lots script); and say how to wait on a long run (in the background, on its PID or the harness's notice, with a bound, judged on its exit code and log - never a `pgrep -f` that matches its own wait).
- The XSDs of core's test dialecte ship with the package: `@dialecte/core/test/xsd/test.xsd` (it imports `test-ext.xsd`, next to it), so a test can validate a document of the test dialecte against its schema (`xmllint --schema`) without a core checkout.
- `requiredChoices({ definition })` in `@dialecte/core/utils`: the choices an element's content model requires (where `childOccurrences` reads each alternative as optional), with how many times each is taken and its branches in order - per branch, how often it holds each child and the choices it requires in turn. Types `RequiredChoice`, `ChoiceBranch`.
- `childOccurrences({ definition })` in `@dialecte/core/utils`: how often each child may appear under an element (`{ min, max }`, `max` undefined when unbounded), read from its resolved definition, a choice and repeated groups included.
- **Agent skills ship with the package**, in `skills/`: `dialecte` (how Dialecte is split, what to reuse before writing a helper, hooks, testing), `dialecte-contributing` (changing Dialecte: where a change goes, the gates, the code rules) and `dialecte-lot` (delivering a change as stations - red-first implementation, an independent review loop capped at three rounds, a commit-by-lots hand-over, a retro). Install them for your coding agent with `npx @dialecte/cli skills sync`. Guide page _Working with AI agents_. The skill's API index (`references/api.md`) lists every method by what it is for, generated from the JSDoc summaries and the new `@intent` tags; `npm run skills:generate` refreshes it, `npm run skills:check` fails when a skill cites what does not exist or a public method has no summary or `@intent` (every public method of the project, document, query and transaction now has both).
- `STORE_DUPLICATE_ID` (`D1009`): what a store answers when a write would take an id the store already holds - a record created (`bulkWrite`, `commit`) with the id of a record of the document, or a document registered with the id of a registered one. `meta` carries `documentId` and, for records, `recordIds` (each refused id once); `detail` says which ids the document already holds and which the write gives twice.
- `STORE_CLOSED` (`D1010`): what a store answers to an operation started after its `close()`, until it is opened again; `meta` carries `storeName`.
- `STORE_READ_FAILED` (`D1011`): what the SQLite project store answers when its database fails under a read (the failure as `cause`), including the reads a bulk write makes before writing (the document's table, the ids it already holds); a failure while writing keeps the write's own key (`STORE_COMMIT_FAILED`, `STORE_BULK_ADD_FAILED`, `STORE_BULK_UPDATE_FAILED`, `STORE_DELETE_FAILED`), but for a write the file could not grow for (`STORE_QUOTA_EXCEEDED`).
- `STORE_VALUE_NOT_JSON` (`D1015`): what every store answers to a write handing it a value that is not plain JSON, in a record or in document metadata; `detail` names the value and the field holding it. Nothing of the write lands.
- `STORE_UNAVAILABLE` (`D1016`): what the SQLite project store answers when the browser gives the page no private file system (a private window) or a worker no synchronous file access; nothing is created. `meta` carries `project`.
- `STORE_QUOTA_EXCEEDED` (`D1017`): what the SQLite project store answers when the origin has too little storage left - for a new project's files, or for an import (eight times the file's size and at least 1 MiB, less the project's free pages: a project file measured up to 7.5 times the XML it was imported from), nothing created or registered (`meta`: `project`, `needed` and `available`, in bytes); and when the file system refuses any write for want of space (an import, a commit, a bulk write, a document registered, updated or removed, an undo or a redo, a blob's change), nothing of it applied (`meta`: `project`, and `available` when the file system says it).
- `PROJECT_ENGINE_UNAVAILABLE` (`D7006`): what a call through the hub answers when no open view can start the project's engine worker, or the engine never said it opened; and what a destroy answers when the project is still being destroyed past the open budget, or the page was suspended before the hub granted it; and what a page answers when the engine worker it started gives no answer to its open within 30 seconds, or stays silent, not busy, for the heartbeat timeout while a new connection waits to be adopted - that worker is ended, the other views' calls in flight on it refused `STORE_ENGINE_LOST` (`host-gone`), and the next call starts another engine; through the hub such an engine is replaced the same way.
- `PROJECT_ENGINE_BUSY` (`D7007`): what opening a project's engine answers when another engine still holds it (another tab, or a worker that did not stop) past the budget; `meta`: `project`, and `budgetMs` (its lock waited for) or `retriedOn` (its files still busy).
- `PROJECT_DIALECTE_MISMATCH` (`D7008`): what opening a SQLite project answers when its file was stored by another dialecte (nothing of it written), and what an engine answers when asked for a project of another dialecte than its own - an `engineUrl` pointing at another dialecte's worker - before it takes any lock or file. A SQLite project is the dialecte's and the name's: projects of one name under two dialectes are two projects, each its own files and its own engine; the hub refuses no view for a dialecte.
- `PROJECT_DIALECTE_VERSION_MISMATCH` (`D7009`): what a view's call answers when the project's engine runs another version of the dialecte than the view.
- `STORE_PROTOCOL_MISMATCH` (`D1012`): what joining the hub answers when another version of the library holds it, and what a page answers an engine speaking another wire (the engine's worker ended): every view of an app runs the same build.
- `STORE_REALM_ID_TAKEN` (`D1013`): what joining the hub answers for an id another connected view already uses.
- `STORE_REALM_UNKNOWN` (`D1014`): what the hub answers a view that speaks to it without having joined, or after it left - a child whose page went before it said hello.
- `STORE_ENGINE_LOST` (`D1018`): what a call to a project engine served from a worker answers when that engine is lost - `meta.reason` is `'host-gone'` (the engine ended, on its own or with what hosted it), `'realm-dropped'` (the hub dropped this view with the page that bound it - frozen, gone, or unbinding it: every call is refused so until the page binds it again with a new port) or `'no-heartbeat'` (it sent nothing for too long while the call waited: it may still finish), with `meta.writeId` for a commit or an import. Ask `getWriteOutcome({ writeId })` before writing again: it answers `'running'` while the write's answer has not come.
- `PROJECT_DESTROY_FAILED` (`D7010`): what destroying a project answers when its files are still there afterwards (another tab or worker holds one). `meta` carries `project`, and `budgetMs` when its worker gave no answer. A file held a moment longer (a worker just ended letting go of it) is waited for within the destroy's budget, and so is the lock of an engine the page ended for giving no answer to a close (still held after that budget: `PROJECT_ENGINE_BUSY` through the hub, `meta`: `project` and `budgetMs`; `PROJECT_OPEN_ELSEWHERE` in direct mode).
- `PROJECT_OPEN_ELSEWHERE` (`D7011`): what opening a project answers when another tab or window has it open and no shared connection between them exists; and what destroying a project answers, on every store, while another connection - of the same page or of another tab - has it open, nothing removed (close that connection, then destroy). `meta` carries `project`, and `connections` (the others open) where the store counts them.
- `PROJECT_DATABASE_LOST` (`D7012`): what opening a SQLite project answers when its files hold data but none of them is its database any more (the database file's header damaged by the disk or another program). Nothing is opened or changed - before, a new empty database was made in its place and the project read empty; every later open answers the same until the project is destroyed: `destroy()` on the same Project instance whose `open` was refused removes what that store holds, without opening it, and `open` then makes it again, empty. `meta` carries `project`. A project whose files never held data (an install or a creation that ended early) opens as a new project.
- `PROJECT_NAME_INVALID` (`D7014`): what every store answers, before it is built, for a project whose name or dialecte id is empty, `.` or `..` (a SQLite project's files sit in a directory named after both, which no directory can be: its private file system threw a raw `TypeError`).
- `PROJECT_DESTROYED_WHILE_AWAY` (`D7013`): what a view's calls answer when it comes back to its SQLite project - its page back from a freeze or the back/forward cache, its engine started again - and the project was destroyed meanwhile by another tab (and maybe made again under its name). Every project file carries the id it was created with; a view tells it as it comes back, and an engine never makes the project again empty for it: nothing is opened in its place, nothing of a project made since is read. `meta.project` names the project.
- `@dialecte/core/engine`: `serveDialecteEngine({ dialecte })`, a dialecte's engine worker entry - the project engine on the origin's private file system, served to every view of the project through ports. The entry carries no SQLite wasm of its own: the engine is handed the consumer's one wasm file (`sqlite3-<hash>.wasm`, emitted once by the consumer's bundler for every dialecte), and ships no sqlite-wasm worker chunk. A call to it hears all its progress before its answer, on any machine: the ticks travel on the call's own port, under an id the call sends; an export its caller aborted before the answer is `EXPORT_ABORTED`. Only the origin's hub spawns it (a view's `connectHub` spawners), and no store reaches it yet: the local store moves to SQLite in a later version.
- `PROJECT_LAYOUT_OUTDATED` (`D7005`): what the SQLite project store answers when a project file was stored by another version of the library (another layout of the file); nothing of the file is written. `meta` carries `layoutVersion` (the file's) and `expectedLayoutVersion` (the library's); delete the project and import its files again.
- Type `ImportTarget`: what an import writes through - the store operations it needs (`registerDocument`, `getDocument`, `removeDocument`, `bulkWrite` for the file's records), `writeSession` for its session's writes once every record of the file is stored (a create of an id the file gave refused `STORE_DUPLICATE_ID` as one the document holds), and `markReady`, the one way a document becomes ready (refused `DOCUMENT_NOT_REGISTERED` once the document is no longer the import's own, `importing`). `runImport` takes one, `parseXmlFile` a `ParseTarget` (`bulkWrite` and `writeSession`); a `Store` is not one. A store runs its own import against a target of its own, so a `close()` after the import started does not cut it short.
- **A dialecte declares itself once.** `defineDialecte({ id, version, configs, defaultConfigKey, extensions?, createHooks? })` returns a frozen `DialecteDeclaration`: the dialecte's identity (the engine stores it with each project) and package version (a client and its engine must run the same one), every one of its configs with the default key (`UNKNOWN_CONFIG_KEY` when the default names none of them), its extension modules and a hooks factory, called once per Project so no hook state is shared between projects or realms.
- `createProjectFactory({ dialecte, engineUrl })` returns the dialecte's project factory: every config, the default key, the dialecte's extensions merged under the consumer's, a fresh hooks instance per project; per call a consumer chooses only `storage`, its own `extensions` and `dev`. The factory carries `dialecte` and `engineUrl`, the address of the dialecte's engine worker, the URL its module exports from a `?worker&url` import of its worker entry.
- Types `DialecteDeclaration`, `DefineDialecteParams`, `CreateProjectFactoryParams`, `CreateProjectParams`, `ProjectFactory`. Doc page `api/dialecte`: what a dialecte provides and what core derives.
- `@dialecte/core/test`: `createTestRunner({ dialecte, storage? })` and `createTestProject({ dialecte?, sourceXml, targetXml?, storage?, dev? })` build each test project from the declaration - every config, the default key, the dialecte's extensions and its own hooks instance per test project, the source (and target) imported under the default config. Without a `dialecte`, `createTestProject` takes `TEST_DIALECTE`, core's own declared test dialecte (its one config under the key `default`, as before); `runTestCases` is built from it. `storage` names the store the test projects run on (the local store by default, `{ type: 'inMemory' }` on request). `createTestContext` takes a `store` to read, or a `databaseName` to open the local store by: one of the two.
- `createTestHelpers({ dialecte, storage?, schemaName?, extraChecks? })` in `@dialecte/core/test`: every test helper of a dialecte from its declaration - `runTestCases`, `createTestProject`, and, bound to the default config, `createTestRecord`, `assertExpectedElementQueries` / `assertUnexpectedElementQueries`, `assertValidXml` / `assertValidXmlTestCases`. The runner checks every case's XML against the schema before the suite runs (all invalid cases at once) and the test project checks its source and target (required attributes may be left out), each against the config the fixtures are imported under: a runner call and a test project take a `configKey` (the default config when absent, `UNKNOWN_CONFIG_KEY` for a key the dialecte does not declare); a runner call's own `dialecteConfig` replaces the config under that key. `extraChecks` (`testCases`, `fixture`) are a dialecte's own checks, run once the schema check has passed; a test project skips them with `skipExtraChecks: '<why>'`. `schemaName` names the schema in the messages, the dialecte's `id` by default; `storage` is the test projects' store, a test project's own `storage` winning. Types `CreateTestHelpersParams`, `TestHelpers`, `TestHelperExtraChecks`, `TestHelperProjectParams`, `XmlAssertions`, `XmlSchemaAssertions`.
- **The import runs inside the store.** `Store.importFile({ file, options, writeId?, onProgress?, signal? })` registers the document `importing`, parses the file with the dialecte's import session, stores it batch by batch, applies the session's writes and sets it `ready`, next to the data; it answers `{ record, recordCount, diagnostics, perf? }` and leaves nothing of a file that fails or is aborted. `InMemoryStore` and the local store run it with the `runtime` they are built with (the project passes its configs and hooks). Core exports the one pipeline every store runs, `runImport(params, { onProgress, signal })` (`params.perf`, optional: the perf its stages are timed on, shared with the store's own target), with types `StoreRuntime`, `RunImportParams`, `ImportFileParams`, `ImportFileOptions`, `ImportFileResult`, `ImportControl`, `ImportProgress`.
- `Store.getWriteOutcome({ writeId })`: what became of an import asked by the id its caller chose - `'running'`, `'applied'` or `'not-applied'` - after a lost connection, before reading again. The id is kept on the document as `DocumentRecord.writeId`. Type `WriteOutcome`; `importOutcomeOf` answers it from a registry for a custom store.
- Import progress and abort: `project.import` / `importFile` options `onProgress` (told `{ phase, bytesRead, totalBytes }` after each stored batch, never awaited: a listener that never answers, rejects or throws neither holds nor fails the import; `phase` is `'storing'`, or `'indexing'` while a store builds an index of the document - the SQLite project store does, before the document is ready, and edits of other views wait meanwhile; type `ImportPhase`) and `signal` (aborts at the next batch, nothing of the file remains). `IMPORT_ABORTED` (`D5005`). `parseXmlFile` takes the same `{ onProgress, signal }` as a second argument.
- `ImportSession.recordTagNames`: a session names the tags whose records `beforeImportRecord` is handed; the other records pass it by, no ancestry handed for them.
- `perf.snapshot()` and `perf.merge({ report, prefix })`: a realm's spans, tallies and `timeOrigin` as data, folded into another realm's perf under `<prefix>::`, spans shifted onto its timeline. `createPerf({ enabled, timeline: false })` keeps spans off the shared timeline. Types `PerfSnapshot`, `PerfSpan`. With `dev.perf` on, each import's stages land on `project.perf` as `store::import`, `store::import::register`, `decode`, `parse`, `standardize`, `hooks.record`, `insert`, `hooks.after`, `writes.after`, `finalize`.
- `removeUnfinishedImports({ store, isRunning? })`: what a store does as it opens - remove every document left `importing`, but those `isRunning` names (an import still running; it may answer asynchronously), each row read again before it goes so an import that ended meanwhile stays.
- `createTestRunner` calls (`withExport` / `withoutExport`) and `createTestProject` take a `configKey`: the fixtures are imported under that declared config (they were always imported under the default one); a call's `dialecteConfig` replaces the config under that key.
- `createTestContext({ databaseName, storage? })` in `@dialecte/core/test`: the store of the project named, of the kind `storage` names (the local store by default) - an in-memory project's records are read by its name.
- **The export runs inside the store.** `Store.exportFile({ documentId, options?, onProgress?, signal? })` reads the document's records next to the data, parent by parent and `batchSize` children per call (never the whole document in one call), writes them as XML with no DOM - formatted (4 spaces, CRLF, a text value on its element's line) or compact (`options.indent: false`) - and answers `{ file, filename, perf? }`, `file` a `Blob` of UTF-8 XML (`application/xml`). Options `indent`, `withDatabaseIds`, `batchSize` (`EXPORT_BATCH_SIZE`, 2000, exported). A write on the document while it is exported, through any connection, restarts it once; a second fails it with `EXPORT_CONFLICT` (`D5006`). `onProgress` is told `{ recordsWritten, totalRecords }` after each written batch, never awaited; `signal` aborts it with `EXPORT_ABORTED` (`D5007`). `InMemoryStore` and the local store run it; core exports the one export every store runs, `runExport(params, { onProgress, signal })`, with types `RunExportParams`, `ExportSource`, `ExportFileParams`, `ExportFileOptions`, `ExportFileResult`, `ExportControl`, `ExportProgress`. With `dev.perf` on, each export's stages land on `project.perf` as `store::export`, `store::export::read`, `store::export::write`, `store::export::assemble`.
- **Writes identified on every store.** `Store.commit` takes the caller's `writeId` (generated when absent), kept on the commit's history entry (`ChangeLogEntry.writeId`); `getWriteOutcome({ writeId })` answers a commit too: `'applied'` once committed until its document is removed - after its undo, and after a later commit discarded it - `'not-applied'` for a refused commit or an id no write carried. `writeOutcomeOf({ documents, writeId, committed })` answers it for a custom store, beside `importOutcomeOf`.
- `parseXmlDocument({ file })`: the DOM of an XML file, in the page; `PARSE_ERROR` when it is not well-formed.
- Types `ProjectExportParams`, `ProjectExportResult`, `ProjectExportResultWithDocument`, `ProjectExportResultMaybeDocument`, `ParseXmlDocumentParams`.
- Core's store contract suite and the project's store switch also run in node, on the in-memory store and on IndexedDB through `fake-indexeddb` (`npm run test:node`). The testing guide says how a package picks the store of its runs (the runner's default, `useTestStorage`, set by its setup file) and what a test may rely on whichever the store.
- `parseDocumentPath({ path })`: a document's path - its folders, then its file name, joined by `/` - read apart into `{ folders, fileName }` (type `DocumentPathParts`). A path is relative and written one way only: no empty folder or file name (no leading or trailing `/`, no `//`), no `.` or `..`, no backslash, no invisible format, separator or control character (Unicode Cc, Cf - bidi overrides, zero-width characters, the byte order mark -, Zl, Zp), well-formed and in Unicode NFC, each folder or file name at most 255 UTF-8 bytes and the whole at most 1024 (`DOCUMENT_PATH_SEGMENT_MAX_BYTES`, `DOCUMENT_PATH_MAX_BYTES`, `DOCUMENT_PATH_SEPARATOR`, `DOCUMENT_PATH_INVISIBLE_CHARACTER`). A path breaking a rule is refused with `DOCUMENT_PATH_INVALID` (`D7030`), `meta.path` the path as given, `detail` the rule; nothing is rewritten.
- **A document's path in the project.** `DocumentRecord.path` (`substations/north.scd`): where a document sits - its folders, then its file name, which is always its `name` + `extension`. `Project.importFile(file, { path })` / `Store.importFile({ options: { path } })` (`ImportFileOptions.path`) and `initEmptyDocument({ path })` place a document as it is registered, its name and extension taken from the path's file name (an extension its config reads). `Store.updateDocument(id, { path })` moves and renames a document (the name follows; the extension stays the document's), `updateDocument(id, { name })` on a document with a path renames the file name in it; type `DocumentUpdates`. A path breaking a rule, naming another file, or changing the extension is refused with `DOCUMENT_PATH_INVALID`; a place another document holds - the same path, or one a folder of the other's - with `DOCUMENT_PATH_TAKEN` (`D7031`, `meta` `documentId`, `path`, `takenBy`); nothing is written. An update takes `name`, `path` and `metadata` only (`DOCUMENT_UPDATE_FIELDS`; any other key, `status` too, is ignored on every store), and checks a stored path again only when it gives a `path` or a `name`. Every store applies the same rules in the same order; helpers for a custom store: `assertDocumentPlace`, `applyDocumentUpdates`, `pathHolderOf` (type `PathHolderCandidate`). An export is named after the path's file name. `Project.import` of several files takes no path (`ImportFilesOptions`): one handed a `path` anyway rejects the call with `DOCUMENT_PATH_INVALID`, no file touched.
- `ELEMENT_TAGNAME_MISMATCH` (`D2004`) carries `meta: { id, expectedTagName, actualTagName }`: the tag the ref named and the tag the record holds.
- `summarizeOperations(operations)`: what staged operations write, one count per record as the commit merges them (a record created then updated is one creation, created then deleted nothing) - `{ creates, updates, deletes, byTag }`, `byTag` in tag order. Types `OperationsSummary`, `OperationCounts`.
- `createSeededRandomUuid({ seed })` in `@dialecte/core/utils`: a stand-in for `crypto.randomUUID` whose ids follow from a seed - the same seed gives the same sequence, each id in the layout of a version 4 UUID. No vitest needed: a Node script installs it to mint the same ids on every run. Types `UuidShaped`, `CreateSeededRandomUuidParams`.
- `evaluateExpectations(query, { expectations })` in `@dialecte/core/helpers`: checks what a document holds against expectations written before the script that builds it, with no DOM - per expectation a tag, optional attribute values (`where`), an optional element it must be under (`under`) and an optional exact `count` (at least one without it, none with `0`). Every expectation is answered, met or failed with the count found and a sentence (`expected 2 Part under Assembly, found 1`); on a prepared transaction's `query` it checks what `commit()` would write. Types `Expectation`, `ExpectationScope`, `ExpectationFailure`, `ExpectationsOutcome`, `EvaluateExpectationsParams`.
- An optional `explanation` per code in error and diagnostic catalogues: `{ when, fix, docs? }` - when it is raised, the usual fix, the docs page. `defineErrors` entries and `DiagnosticCatalogueEntry` take it; every entry of the core catalogue (`ERROR_CATALOG`) has one. Type `CatalogueExplanation`.
- `useTestStorage(storage)` in `@dialecte/core/test`: the store every test helper opens its projects on when a call names none (`createTestRunner`, `createTestProject`, `createTestHelpers`, `createTestContext`), for the whole process - a runner's setup file calls it, `useTestStorage({ type: 'inMemory' })` for a node test project; a call's own `storage` still wins, and `undefined` gives the local store back. It is never read from an environment variable.

### Changed

- **Breaking:** `new InMemoryStore(name)` and `new DexieStore(name)` (and a Project on them) refuse a project named with nothing, `.` or `..`, or of such a dialecte id, `PROJECT_NAME_INVALID`, as every store does; they took any name.
- **Breaking:** `updateDocument` takes no `status` (`DOCUMENT_UPDATE_FIELDS` is `name`, `path`, `metadata`): a status handed is ignored, as any other key it does not take. Only its import marks a document ready, once every record and write of its session is stored: a status set through another connection while an import ran could leave a SQLite document ready without the session's writes or its indexes.
- **Breaking:** an in-memory project is its dialecte's and its name's, as a SQLite one: two dialectes' projects of one name in a page are two projects. A Project made by a dialecte's project factory or test helpers tells its store its dialecte (`new Project({ dialecteId })`, `new InMemoryStore(name, { dialecteId })`); `createTestContext({ databaseName })` takes the project's `dialecteId` to read it (`project.dialecteId`, readable now). A Project or store given no dialecte keeps a state per name: a project made by a dialecte's factory or test helpers and a plain `new Project` (or `new InMemoryStore`) of the same name no longer share their in-memory state. The local (IndexedDB) store stays keyed by name until it moves to SQLite; the project's BroadcastChannel stays keyed by name.
- **Breaking:** `Store.close()` returns a promise on every store, settled once the connection counts no more: its running operations ended and, for a store shared across tabs, its hold let go - a destroy of the name asked after it, from this page or another tab, is not refused for it. `Document.close()` and `closeTestContexts()` return that promise too: await them before destroying the project. Never await a close inside an operation of the same store (a hook, a transaction callback): it waits for that operation.
- `project.close()`'s console report after 10 seconds names the files of the imports it still waits for. An import whose dialecte hook never settles keeps a close waiting for good: nothing aborts a hook, so an import hook must settle (the IO hooks page says so).
- **Breaking:** a Project's `open`, `close` and `destroy` run one at a time, in the order called, and a call made from an `open`, `close` or `destroy` call on is refused (`PROJECT_NOT_OPENED`) until the last `open`, `close` or `destroy` called has settled (`open(a)` twice without waiting: the first caller's calls are refused until the second has settled). `open` on a Project already open - on another project or on the same one - first closes it as `close()` does: `state.documents` then holds only the new open's documents (a document of the previous project was left in it, `openDocument` returned a Document bound to the new project's store, and a write of the previous project still running - a batch import's later files, a document made or removed, an undo, a redo, a blob's change, a Document's commit - landed in the new project's state or channel). A batch `import` and a Document belong to the open they were made in: a file whose turn comes after it closed is a failed entry `PROJECT_NOT_OPENED`, and a Document's commits are told to no later open. The Documents of the previous open answer `STORE_CLOSED` when the store is made for each open (`local`, `inMemory`); a `custom` store is the same one opened again. `close()` now also waits for the project's writes running (a document made or removed, an undo, a redo, a blob's change, a Document's transaction or prepared commit - before, a commit in flight was refused `STORE_CLOSED` and the edit lost) and the work other realms' messages started, empties `state.documents` and drops the Documents' subscriptions; `openDocument` on a closed project answers `PROJECT_NOT_OPENED` first. An `open` whose store refuses, or whose documents cannot be read, closes again the channel and the store it opened. `queryFirst` and `queryAll` answer `PROJECT_NOT_OPENED` on a project not open, and when it closes or another opens while they run; they could return an empty or partial answer, or one mixing two projects. A Document's transaction or prepared commit started once a close is called is refused `PROJECT_NOT_OPENED`, nothing written, as the Project's own writes are. A close still waiting after 10 seconds says once on the console what it waits for (imports, writes) and goes on waiting: never await `open`, `close` or `destroy` inside a hook or a transaction callback.
- **Breaking:** `assertValidXml` (from `createXmlSchemaAssertions` and `createTestHelpers`) takes one object: `assertValidXml({ xml, label?, requireComplete? })`. Was `assertValidXml(xml, label?, { requireComplete? })`. Type `AssertValidXmlParams` replaces `AssertValidXmlOptions`.
- **Breaking:** the XML assertions of `@dialecte/core/test` read XML the same way in node and in a browser, with one engine: libxml2 (`libxml2-wasm` `0.7.2`, pinned exactly, bundled into the `@dialecte/core/test` entry; the main entry does not load it), instead of the page's `DOMParser`, `XMLSerializer` and `document.evaluate`. `assertExpectedElementQueries`, `assertUnexpectedElementQueries` (and `createXmlAssertions`), `runTestCases` (`createTestRunner`, `createTestHelpers`) and `assertValidXml` / `assertValidXmlTestCases` (`createXmlSchemaAssertions`) all go through it. A runner's cases now run in node.
- **Breaking:** the query assertions take XML text only, `{ xml, queries }`: a caller holding a page `Document` serializes it. An assertion call parses its text once for all its queries; the runner parses a case's output once for its expected and unexpected queries, and parses an `assertOn: 'custom'` case's `xmlString`.
- **Breaking:** `splitXpathIntoSteps` is no longer exported from `@dialecte/core/test`.
- A failed query assertion says why in labelled lines: the query, the steps that matched (`step k of n`), the step that failed, where the last match sits (its positional path and line; `line ≥ 65535` past the last line the engine keeps), what the failing step finds without its predicates under every match (`nearby`: up to ten candidates with the attributes the predicates name, or `none: <tag> has no <name> child`, naming the same local name in another namespace with the prefix to type), and the XML around it, cut at 200 lines. An unexpected node found is printed with its place; a missing ancestor of an unexpected query fails as `Unexpected element check unreliable`. A query with a top-level `|` is reported as a whole. A query the engine refuses (a syntax error, a prefix the namespaces do not bind, an expression answering a value) fails as `Query refused` with the reason; nothing is written to the console.
- Text that is not well-formed is refused with `<label>: malformed XML - <line>:<column> <libxml2's reason>` (`queried XML` for the query assertions, the fixture's label for `assertValidXml`), and an XML declaration after leading XML whitespace or a byte order mark with `<label>: malformed XML - the XML declaration must be the very first characters ...`. As in XPath 1.0: namespace declarations are not attributes (`@*` and `count(@*)` leave them out), the XML declaration and the whitespace around the root are no nodes of the document, and an expression naming a prefix no namespace is bound to is refused, whatever the document. `project.export({ xmlDocument: true })` is unchanged.
- Core's own tests run in two tiers: `npm run test:node` runs every test file in node on the in-memory store (`node`, with the store contract and the project's store switch also on IndexedDB through `fake-indexeddb`: `node-indexeddb`), `npm run test:browser` the files that need a browser (the store contract on IndexedDB and on SQLite over OPFS, the engine workers, the save dialog, `xmlDocument: true`, the IndexedDB-specific cases), each listed with why; `npm run test` runs both, `npm run test:browser:all` the whole suite in Chromium (CI, before a merge). The testing guide describes the tiers and how a package picks the store of each.
- **Breaking:** a store `createTestContext` opens by its project's name (no `store` given) is a connection of its own, so the project's `destroy()` is refused `PROJECT_OPEN_ELSEWHERE` while it is open: call `closeTestContexts()` (new in `@dialecte/core/test`) first.
- **Breaking for the in-memory and the local store:** `destroy()` is refused `PROJECT_OPEN_ELSEWHERE` while another connection of the project is open - another store of the name in the page, or (local store) in another tab - and removes nothing; it removed the project under that connection before. Close the other connections, then destroy. A store whose destroy is refused stays counted open, as it was, unless closed meanwhile. Two connections destroying at once are both refused (the local store: in one page; two tabs destroying a local store at once may both go ahead). A project whose destroy is refused is closed all the same, as by `close()`: call `destroy()` again once the other connection closed; a Document's `destroy()` refused keeps its connection. A store closed counts open no more, and a destroy lets the operations it still runs complete first (a store of another tab counts until they end); a store destroyed counts open no more either, until its next operation; on the SQLite store, one whose destroy went ahead then failed (`PROJECT_DESTROY_FAILED`) likewise connects again on its next operation. A connection made while another connection's destroy runs either counts - the destroy refused, its data kept - or waits for the destroy and reads the project empty; it never fails, and never reads the old data after a destroy that resolved (across tabs in direct mode, the engine's lock keeps one tab's engine at a time, as ever). A store counts open from its `open()` or its first operation, used without `open()` too, until its `close()`; an operation started on a store while its own destroy runs goes on once the destroy has ended, and keeps it from nothing - on the local store, one started just before the destroy and still waiting for that store's hold of the project is not waited for (the local store goes in a later release). Destroys of a store run one at a time. A local store's reads after its own destroy answer empty (they threw `DatabaseClosedError`). The SQLite store, not released yet, answers the same, through the hub and in direct mode alike.
- The SQLite project store's page cache follows the device's memory (`navigator.deviceMemory`, 4 GiB when the browser does not report it): 64 MiB per GiB, between 64 and 512 MiB, outside imports as during them; it was a fixed 64 MiB outside imports. On a device of 8 GiB and more, deleting a tenth of a 500 MB document takes about 4.5 s instead of about 10 s.
- **Breaking:** `prepared.summary` counts records as the commit writes them, no longer staged operations: a record updated twice, or created then updated, counts once; it gains `byTag`, the counts per tag.
- **Breaking** (tests): `createMockRandomUUID({ seed? })` (`@dialecte/core/test`), and so the ids `runTestCases` gives elements created during `act`, are UUID-shaped ids of a seeded sequence (seed 0 by default), no longer a counter (`"0"`, `"1"`, ...). An assertion on a created element's id reads it from `createSeededRandomUuid({ seed: 0 })`. The testing guide's examples target record ids as the export writes them, `_temp-idb-id`.
- `@sqlite.org/sqlite-wasm` (`3.54.1-build1`) and `comlink` (`4.4.2`) are dependencies of `@dialecte/core`, pinned to exact versions: the SQLite project store runs on them. An install of core now brings them. A project's files whose install fails (a file that cannot be opened) are kept: sqlite-wasm removed the whole project when its install failed. An engine running an older sqlite-wasm than 3.54.1 (an `overrides` entry, a stale install) refuses to open any project with `ASSERTION_FAILED` naming the version (`meta`: `project`, `sqliteVersion`), before it takes the lock or touches a file: such a version removes the whole project when an install fails.
- **Breaking:** `project.export` takes one object and answers the file: `project.export({ documentId, indent?, withDatabaseIds?, xmlDocument?, download? })` returns `{ file: Blob, filename }`, the store's export. `xmlDocument: true` also answers the DOM, parsed from the compact file in the page (pass `indent: false` to export once); `download: true` (or `{ filename }`) also saves the formatted file - the save dialog is asked before the export runs, while the click still counts as the user's gesture, a dialog refused for a lapsed gesture falls back to a download, and any other failing save is thrown. Was `project.export(documentId, { withDatabaseIds, withDownload })` returning `{ xmlDocument, filename }`. The parsed DOM is the document the records make; its attributes also hold the namespace declarations written into the file; the compact file writes a text value's carriage return as `&#13;`, so the DOM keeps it.
- **Breaking:** a document still `importing` cannot be exported: `exportFile` refuses it with `DOCUMENT_NOT_REGISTERED`, as a document not registered.
- **Breaking:** the `Store` port has a required member more, `exportFile`: a `{ type: 'custom' }` store runs `runExport` with a source of its own (its reads and the per-document write version).
- The exported XML is written by core itself, no longer by the browser's `XMLSerializer`: the same bytes in every browser (the Chromium bytes of before, but for the compact file's `&#13;` for a text value's carriage return; a file exported from Firefox may differ from what Firefox wrote).
- **Breaking:** `project.exportBlob` takes one object, as `export` does: `project.exportBlob({ blobId, download? })`, `download: true` (or `{ filename }`) saving the blob - under another filename the save dialog is opened before the blob is read. Was `project.exportBlob(blobId, { withDownload })`; type `ExportBlobOptions` replaced by `ProjectExportBlobParams`.
- **Breaking:** `saveToDisk` throws a failing save instead of logging it and resolving; a save dialog refused because the user's gesture lapsed (work awaited before the save) falls back to a download of the same file, and one the user cancels still saves nothing.
- `Project.import` / `importFile` hand each file to the store (`Store.importFile`) and keep only the project state and the broadcast.
- **Breaking:** an import left unfinished (a tab closed mid-import) is removed when the store opens - `InMemoryStore.open` and the local store's `open` do it; the project no longer sweeps at open nor every five minutes. The local store keeps an import another tab or frame still runs: each import holds a Web Lock while it runs (where Web Locks are missing, every unfinished import is removed).
- **Breaking:** `Perf` has two more members, `snapshot` and `merge`: a hand-written `Perf` or test double adds them (`NOOP_PERF` has them).
- **Breaking:** `project.importFile` throws a plain `Error` from an import hook as `IMPORT_FAILED`, the `Error` as its `cause` (it threw the `Error` itself); a failed entry of `project.import` is unchanged.
- **Breaking:** the `Store` port: `importFile` and `getWriteOutcome` are required members; `get(id, documentId)` requires the document (no lookup across documents); `updateDocument` no longer takes `importingAt`. A `{ type: 'custom' }` store implements the two new members (`runImport`, `importOutcomeOf`) and removes leftovers as it opens (`removeUnfinishedImports`).
- **Breaking:** `resolveStore({ name, storage, runtime, perf? })` takes one object, with the runtime its store imports with.
- **Breaking:** the dev perf names of the import are `store::import::*` (see Added); the `core::import::*` names and the per-batch `core::store::bulkWrite` span are gone.
- **Breaking:** the in-memory store holds one state per name in a page, as IndexedDB holds one database per name: every in-memory store, and every in-memory project, of a name reads and writes it. `close()` keeps it; only `destroy()` frees it - an in-memory project never destroyed keeps its memory until the page goes, and a test that builds an in-memory store or project under a fixed name without destroying it leaves its data to the next one of that name in the same worker. A placeholder (`writable: false`) never reads, keeps or frees the state of its name: it reads empty, and its `destroy()` leaves the data.
- **Breaking:** records are values on every store: the in-memory store copies what it is handed and what it hands out, as IndexedDB always did - a caller changing a record, a document, a changelog entry or a blob entry it wrote or read no longer changes the store. The copies cost the in-memory store time on large documents (a whole-document read of 184,000 records takes about 0.4 s). What a store keeps is plain JSON: see the next entry.
- **Breaking:** every store keeps plain JSON values only, in records and in document metadata: strings, finite numbers, booleans, null, and arrays and plain objects of them, nested at most 512 levels counted from what a write hands (its list of records or patches, or the document). A Date, a Map, a Set, NaN or Infinity, a BigInt, a function, a symbol, an instance of a class, a raw JSON value (`JSON.rawJSON`), an object with a `toJSON` method (never called), `undefined` in an array, a cycle or a value nested deeper is refused with `STORE_VALUE_NOT_JSON` (`D1015`) before anything of the write lands, in memory, on IndexedDB and on SQLite alike, in the same order (the in-memory store and IndexedDB kept a Date, a Map or a Set as given; the in-memory store kept a function as given, IndexedDB refused one in a created record with `STORE_BULK_ADD_FAILED` and threw the raw `DataCloneError` elsewhere). A field holding `undefined` is dropped: it reads back absent, `updateDocument(id, { name: undefined })` leaves the name and `updateDocument(id, { metadata: undefined })` no longer clears the metadata. A proxy over a plain object (a reactive object) is kept as the plain object it reads as. Write a date as its ISO string or a number. An import whose session says a diagnostic that is not plain JSON (a function in its `meta`) is refused `STORE_VALUE_NOT_JSON` by every store, nothing of the file kept. Hand values that read the same each time: one that does not (a getter answering something new) is kept as it read for one store and may be read again by another. The check costs a write about 0.3 ms per 1,000 records, and the copy the in-memory and IndexedDB stores keep about 0.6 ms.
- **Breaking:** a project `createTestProject` opens inside a running test (its body or a `beforeEach`) is destroyed when that test ends, so a test that forgets it leaves no store behind - and a project opened in one test can no longer be used in a later one: open it in `beforeAll` (or at module scope), where it stays the caller's to destroy. A destroy by the caller as well is harmless.
- **Breaking:** a store closed by `close()` refuses every operation started after it with `STORE_CLOSED` (`D1010`, `meta.storeName`) until `open()` again, on every store; an operation already running completes - the IndexedDB connection closes once it has, and `open()` and `destroy()` wait for it; an `open()` followed by a `close()` before it ends is refused, the store staying closed - and the other connections of the name go on. On IndexedDB most operations threw the raw `DatabaseClosedError`, a commit `STORE_COMMIT_FAILED`, a running operation could fail midway, and registering a document reopened the database; in memory every operation went through. `document.close()` closes the project's store, which every document of the project shares: every document taken before is refused from then on; once the project is opened again, take them again with `project.openDocument`.
- **Breaking:** the list reads of every store answer in id order - `getDocuments`, `getByDocumentId`, `getByTagNameInDocument`, `getBlobsByDocument`, `getBlobsByRecord`, `getStandaloneBlobs` - as IndexedDB always did; the in-memory store answered in the order written. The query results built on them (`getRecordsByTagName`, the record of a tag, `findByAttributes`) now come in the same order in memory and on IndexedDB.
- **Breaking:** `ChangeLogEntry.writeId` is required: a `{ type: 'custom' }` store writes it on every history entry. Entries an IndexedDB project kept from before have none.
- **Breaking:** every store keeps a record as its type has it - `id`, `tagName`, `namespace` (`prefix`, `uri`), `attributes`, `value`, `parent` (`id`, `tagName`, or `null`), `children` - and drops any other field the object carries at its top, in its namespace or in its parent, after checking the whole record as JSON; a bulk-write patch's extra fields are dropped the same way. The in-memory store and IndexedDB kept them; the SQLite project store never did.
- **Breaking:** a commit on a document still `importing` is refused with `DOCUMENT_NOT_REGISTERED`, nothing written, on every store (as an export of it); an import's own bulk writes go on as before.
- **Breaking:** a blob entry (`addBlob`) and a reference attached to a blob (`attachBlob`) hold plain JSON values only, as records and document metadata do: a value that is not JSON is refused with `STORE_VALUE_NOT_JSON`, nothing written, after the owner document (`DOCUMENT_NOT_REGISTERED`) or the blob (`STORE_BLOB_NOT_FOUND`) is checked. A field holding `undefined` is dropped.
- **Breaking:** every store keeps well-formed text only: a string or an object key holding a lone surrogate (`!text.isWellFormed()`) - in a record, a patch, a commit (its `writeId` too), document metadata, a document's name, path or other field as registered or updated (a `path` handed to `importFile` is refused before, with `DOCUMENT_PATH_INVALID`), a blob entry or reference, an imported file (`&#xD800;`) or a diagnostic its import session says - is refused with `STORE_VALUE_NOT_JSON`, nothing written, where any value that is not JSON is refused (a commit checks its `writeId` right after its document). The in-memory store and IndexedDB kept such text; the SQLite project store would read it back changed (U+FFFD in its place), so the stores would differ. Every store keeps well-formed text as written, the SQLite project store included (a leading byte order mark kept), and an id or a tag name a call looks up that holds a lone surrogate names nothing on any store, unless IndexedDB data written before already holds that key: it still answers to it. A record or a document already holding a lone surrogate on IndexedDB still reads as it is, but a write handing it back whole is refused: write it well-formed first (`text.toWellFormed()` turns each lone surrogate into U+FFFD).
- **Breaking:** an imported text value is trimmed and collapsed on XML whitespace only - space, tab, carriage return, line feed: each run of text (between two tags, comments or other markup) loses that whitespace at its ends and each inner run of it becomes one space, as before; every other character JavaScript counts as whitespace too is kept as written (a no-break space - also as `&#160;` -, a leading byte order mark, U+2028, U+3000), but a vertical tab and a form feed, which XML does not allow (below). They were dropped at a value's ends and collapsed into one space inside it. The export (`exportFile`, `project.export`) and `getSnapshot({ as: 'xml' })` trim a value of XML whitespace only, so they write them back (a value of no-break spaces only is written as text, no longer as an empty element). An `xsi:type` value padded with one of them is read as a type whose name holds it (it was read without it): before a prefix, it starts that prefix, bound nowhere, and the value is kept as written; otherwise it is part of the type's local name. CDATA is kept as written, as before. Documents imported before keep the values they were stored with.
- **Breaking:** a character XML does not allow - a control character below U+0020 but tab, line feed and carriage return, U+FFFE, U+FFFF - is never imported from a file nor written into one. A file holding one in a text value, CDATA or an attribute value, as written or as a character reference (`&#11;`), fails its import with `PARSE_ERROR` (`meta.reason` `'not-xml-character'`, `meta.character` `U+000B`; `detail` names the element and the attribute), nothing kept. Before, a vertical tab or a form feed at the ends of a text value was dropped as whitespace (inside it, collapsed into a space), so such a file imported and exported cleanly: it now fails. Every other such character, and any in CDATA or an attribute value, was imported as written and its export was a file no XML parser reads. A transaction or an import session writing one - in a value, a namespace URI, a name or a prefix - is refused with `XML_CHARACTER_NOT_ALLOWED`, and an export of a record already holding one too; a name a hook gives a record on import is refused by the export, not by the import. A record stored before that holds one (IndexedDB data) cannot be exported, and a transaction writing it again - an update of another of its attributes, a child of it deleted, which updates it, a clone of its subtree - is refused: write it without the character first, in an update that replaces that value. (A lone surrogate, the rest of what XML does not allow, every store already refuses.)
- A commit's progress (`onProgress(current, total)`) is told once the commit has landed, on every store: a listener reading the store sees the whole commit, and a listener that throws or rejects is ignored - the commit stands whole, undoable (in memory it was left half written with no history entry; on IndexedDB it was rolled back).

### Removed

- **Breaking:** `buildXmlDocument`, `BuildXmlDocumentParams`, `xmlDocumentToString`, `formatXml` (of the XML build module; the `formatXml` of `@dialecte/core/utils` stays), `downloadFile`, `exportDocument` and the types `ExportDocumentOptions`, `ExportDocumentResult`, `ExportDocumentParams`: the store writes the XML (`Store.exportFile`), `project.export` answers the file, its DOM (`xmlDocument: true`) and its save (`download`); `parseXmlDocument` gives the DOM of a file. `TEMP_IDB_ID_ATTRIBUTE_NAME` stays.
- The `xml-formatter` dependency.
- **Breaking:** `IMPORT_HEARTBEAT_MS`: an import no longer says it is alive; the store that runs it knows.
- **Breaking:** `STALE_IMPORT_MS`: no timed sweep; a store removes every unfinished import as it opens.
- **Breaking:** `DocumentRecord.importingAt`, and `importDocument` with its types `ImportDocumentParams` / `ImportDocumentResult` - `runImport` and `Store.importFile` replace them.

### Deprecated

- `dialecteConfig`, `extensions` and `hooks` on `createTestRunner` and `createTestProject`: the dialecte in parts, one config under the key `default` and one hooks instance shared by every project. Declare the dialecte with `defineDialecte` and pass it as `dialecte`. Both forms keep working; a per-case `dialecteConfig` or `hooks` on `withExport` / `withoutExport` still applies over either.

### Fixed

- A session create reusing an id the file gave is refused `STORE_DUPLICATE_ID` at the session's write on the SQLite store, the id named as one the document holds, as on the others: it was refused only at the id index's build (`phase: 'indexing'`), as an id "given twice". An import marks ready only the document it registered: on the in-memory and local stores, another document registered `importing` under its id meanwhile was marked ready in its place.
- A browser that refuses to estimate the storage an origin has left no longer fails a SQLite project's creation or import with its own error: it is trusted, as one that tells no quota.
- An import started while a SQLite project's engine gives back the free pages a dead import left no longer commits its window at every step of it: the give-back waits until the import has ended.
- A SQLite project's engine whose failed import could neither roll back nor commit its last window (a lost file handle, no memory) closes and is started again on the file, where it went on with a transaction left open: every later write failed to begin, and the next import's end committed the failed import's rows and left the connection unsynchronised until a restart. The worker running it ends (its clients find their host gone and the next engine starts); in the page, the next call starts a new engine. A call the broken engine still gets is refused `STORE_ENGINE_LOST` (`reason: 'host-gone'`), a read made again on the next engine. An engine's close closes its database whatever failed before it, and a SQLite module loaded without `loadSqlite` refused at the start closes the database it was handed, as every failed start does.
- `getWriteOutcome` of an import that failed and whose removal failed too answers `not-applied` on the in-memory and SQLite stores, where it answered `running` until the next start: their store sees every import of the project, and a document `importing` whose import does not run is a leftover. `importOutcomeOf` and `writeOutcomeOf` take `isRunning` for a custom store that knows it too. The local store still answers `running` (it sees no import of another tab) until it moves to SQLite.
- A Document whose state subscriber throws as a transaction starts or ends takes the next transaction; it refused every later one `CONCURRENT_TRANSACTION`.
- `project.destroy()` removes the project a refused `open` was for (its store closed again and never opened); it did nothing, or - on a Project that had opened another project before, or when an `open` was called while the destroy waited for the imports in flight - destroyed that other project.
- `formatXml`, `formatEmbeddedXml` and `dialecte-xmlfmt` drop XML whitespace only (space, tab, carriage return, line feed) between elements: a no-break space, a byte order mark or U+2028 next to a child is text, kept with the element's content as written. They were dropped as whitespace, changing the text.
- `assertValidXml` names a byte order mark before the XML declaration ("the byte order mark (U+FEFF) before it"); it called it whitespace. A no-break space there is not whitespace: the parser's own message says what is wrong.
- A commit that creates and deletes one record leaves nothing of it after its redo; in memory and on IndexedDB the redo brought it back. A commit deleting a record it also updates keeps that record, in its history, as the commit left it before the delete; its undo gives back the record as it was before the commit.
- An undo or a redo over records a bulk write changed since (outside history) writes them as the history holds them, on IndexedDB as in memory: a deleted record created again by a bulk write is overwritten by the undo, which failed on IndexedDB.
- `doc.prepare` and `prepared.commit()` throw `CONCURRENT_TRANSACTION` while another transaction is open on the Document, as `doc.transaction` does: a prepare inside a transaction, two prepares at once, or a prepared commit inside a transaction staged against records the open transaction was about to overwrite, and the later commit lost the other's writes (an element orphaned).
- An exported file keeps each text value on its line (`<Item>2025-08-04 10:59:16</Item>`); it was written wrapped in a newline and indentation, which added whitespace to values (a strict XML reader saw a different value) and made a file with many text values noticeably larger. An element holding text and children is now written as is on one line, where whitespace text used to be inserted between them. The XML of `getSnapshot({ as: 'xml' })` is written the same way.
- A child a wildcard of its parent admits, and that the parent does not declare, is exported at the wildcard's place in the parent's content model; it was written after every declared child, where a schema validator refuses it when the wildcard comes first (an element of another namespace under an extension element whose `xs:any namespace="##other"` precedes its children). The child's namespace is read from its declared tag: a child whose tag the dialecte does not declare, like a child no particle admits or one every admitting wildcard has no room left for (`maxOccurs`), still goes last. Such a child that was written last now moves before the declared children when the parent's wildcard comes first: an output compared against the former order (test fixture, snapshot) changes. `getTree` and `getSnapshot` order their children the same way. `orderByConfigSequence` takes the dialecte's `definition` (optional) to place them so; without it, a child outside the sequence goes last as before.

A store refuses what it cannot apply whole, on IndexedDB and in memory alike:

- A create of an id the document holds, or one id twice in the same write, is `STORE_DUPLICATE_ID` and nothing of the write lands - in memory the record was overwritten; on IndexedDB a bulk write threw the raw `BulkError` and a commit wrapped it twice as `STORE_COMMIT_FAILED`. An import whose file yields one record id twice (`useCustomRecordsIds`, or an import hook creating an id the file holds) fails on the in-memory store too, the document removed, instead of keeping the last record.
- A commit updating a record the document does not hold is `STORE_RECORD_NOT_FOUND` before anything is written - the undo entry carried no `before`, so the undo of it threw. A commit with several faults is refused for the first of: the document not registered, an update of an absent record, a taken id - the same on every store.
- A write to a document that is not registered is `DOCUMENT_NOT_REGISTERED` - in memory it created the records of a document nobody registered; on IndexedDB it was a raw `InvalidTableError`.
- Registering an id already registered is `STORE_DUPLICATE_ID` - in memory the document and its records were replaced.
- A structured error thrown inside a commit keeps its key on IndexedDB; it was wrapped as `STORE_COMMIT_FAILED`.
- A document that is not in the store reads as absent on IndexedDB too: `get`, `getByDocumentId`, `getMany`, `getByTagNameInDocument` answer empty and `count` answers 0 for a document never registered or removed (here or in another realm), as the in-memory store did; IndexedDB threw a raw `InvalidTableError`.
- An in-memory project closed and opened again under its name finds its documents, as a local one does; it found an empty store.
- The in-memory store applies the scalar fields of a bulk-write patch (`tagName`, `value`, `parent`, `namespace`); only `attributes` and `children` were merged, the rest was dropped. A patch removing attributes with `attributes` given as `undefined` no longer throws in memory. On IndexedDB a field given as `undefined` in a bulk-write patch is now left as it is; it was cleared.

## [0.7.0] - 2026-10-21

### Added

- **A `Diagnostic`** - what an import hook (and, later, a validation rule) says about one record of a document, in the shape of the language-server protocol: `code`, `severity` (`error` | `warning` | `information` | `hint`), `source` (who said it), `message`, `ref` (the record, and the attribute when it is about one), `related` (the other records it involves) and `meta` (what it is about, as data). Plain data, so it crosses a worker boundary as is. A dialecte declares its codes in a `DiagnosticCatalogue` (`source` + `codes`, each with its severity, family and default wording), builds one with `createDiagnostic(catalogue, code, { ref, meta, related, message? })` and a consumer narrows one with `isKnownDiagnostic(diagnostic, { catalogues })` - matched on the pair `source` + `code`, so two dialectes may share a code.
- The import of a file returns what its import session had to say: `parseXmlFile` and `importDocument` carry `diagnostics: Diagnostic[]`, always present (`[]` when nothing). `Project.import` returns them with each file's entry (below).
- `Project.importFile(file, options)`: one file, the imported document returned (`ImportedDocument` - `fileName`, `documentId`, `recordCount`, `diagnostics`) or the failure thrown, for a caller that has one file and wants the throw.

### Changed

- **Breaking:** `Project.import(files, options)` returns one `ImportEntry` per file, in the order given, and no longer rejects for a file. An imported entry is `{ status: 'imported', fileName, documentId, recordCount, diagnostics }` - `diagnostics` what the file's import session had to say (`[]` when nothing; an open union, narrowed with `isKnownDiagnostic`). A failed entry is `{ status: 'failed', fileName, error }` - nothing of that file lands or is broadcast, the next file is still attempted, and `error` is the structured error of what failed: `PARSE_ERROR` for a malformed file, a dialecte's own error when its import hook threw it, or `IMPORT_FAILED` (`D5004`, new) wrapping anything else, its `detail` the message and its `cause` the thrown `Error` (kept for a console; an entry is plain data, `cause` excepted). The call rejects only for what is about the call: an unknown `configKey` (`UNKNOWN_CONFIG_KEY`, checked once before any file is touched) or a project not opened, closed or destroyed (`PROJECT_NOT_OPENED`). It returned `{ documentId, recordCount }[]` and rejected at the first failing file, the files after it not attempted: a caller that read `results[0].documentId` calls `importFile`; one that imports several files reads the entries.
- A project imports one file at a time: `import` and `importFile` calls made while another import runs wait for it, in call order, so two imports never interleave on the registry (on IndexedDB, a document removed under a sibling's write reopened the database). **Breaking:** `close()` returns a promise; `close()` and `destroy()` wait for the file in flight before closing the channel and the store, so it lands, is in the store and is broadcast; an `importFile` call made after `close()` rejects `PROJECT_NOT_OPENED`, and in an `import` of several files the files after the one in flight are `failed` entries keyed `PROJECT_NOT_OPENED` (nothing of them stored), the call still resolving. A closed project refuses every method that reads or writes the store with `PROJECT_NOT_OPENED` (`openDocument`, `export`, the registry reads, the blobs); it threw a store error or, in memory, went on.
- **Breaking:** the import hooks are one session per file. `IOHooks` loses `beforeImportRecord` and `afterImport`; it gains `createImportSession({ documentId, configKey })`, called once per file imported, which returns an `ImportSession` holding those two hooks. The state a dialecte keeps between the records of a file is now that file's only - two imports can no longer share it, and no reset at the end of `afterImport` is needed. `AfterImportResult.warnings` (an `ImportWarning[]`, which core dropped) becomes `diagnostics` (a `Diagnostic[]`, which core returns); `ImportWarning` is removed.
- `parseXmlFile` takes `configKey`, given to the import session.
- **A document is whole or absent.** `importDocument` registers the document with `status: 'importing'` and sets it to `'ready'` once the last record is stored (`DocumentRecord.status`, new, with `DocumentStatus`; a record stored before the field existed reads as `ready`). Whatever fails in between - the parse, an import hook, a store write - removes the document again and is thrown to the caller; before, a failed import left a half document that `open()` hydrated after a reload. A document still `importing` is never opened, listed (`getDocuments`, `getDocument`, `getDocumentStatus`) or hydrated from a broadcast - here or in another tab. While it imports, a document says it is alive every `IMPORT_HEARTBEAT_MS` (2 s, `importingAt`); `open()` removes the ones whose heartbeat is older than `STALE_IMPORT_MS` (5 min: a tab closed mid-import) and leaves a live import of another tab alone; an open project sweeps again every `STALE_IMPORT_MS`, so a tab that dies later leaves nothing behind either. `Store.updateDocument` accepts `status` and `importingAt`.
- `Project.import` imports the files one after the other, in the order given, and puts each one in the project state (and broadcasts it) as it lands - they were parsed at the same time and registered only once all had landed.

### Fixed

- A malformed file rejects the import with `PARSE_ERROR` - its `detail` says what the parser saw (`Unexpected close tag`, `Unclosed root tag`, `Text data outside of root node.`, …) and `meta` carries `reason: 'malformed-xml'` with the parser's words - instead of being swallowed: the sax error was only recorded, so an error in the last chunk or at the end of the file (a root never closed) let the import succeed with a truncated document. A second root element, which the parser lets through, is a `PARSE_ERROR` too (`reason: 'second-root'`).

## [0.6.4] - 2026-10-16

### Added

- `readAttribute` and `readAttributes` in `@dialecte/core/helpers`: read the attributes of a record you hold the way `getAttribute` / `getAttributes` read them - same `namespace`, `defaults` and `fullObject` options, same results - with no query, synchronously, for an import pass or a pure composer. `getAttribute(s)` delegate to them once they have the record (no behaviour change). They read the record as held, staged operations not consulted: inside a transaction, use the query. Plain types (`string`, `Record<string, string>`, `AnyAttribute`); typed reads stay on the query.

## [0.6.3] - 2026-10-16

### Changed

- `findDescendants` no longer issues one store read per ancestor step. A flat collect climbs each candidate's parent chain through a per-call memo (each ancestor read once; sibling candidates share theirs). Once a call has issued more store reads (by id or by tag name) than one whole-document read is worth for this document - its record count times a per-record cost measured on IndexedDB, never before 128 reads - it reads the document once, staged operations overlaid as `getTree` does, and serves the rest from memory. The path form (`collect: { A: { B: true } }`) reads through the same source. A flat collect under the document root with no `omit` climbs nothing: it relies on every record of a document lying under its root. The result is unchanged; the docs now say that a group's records come in no guaranteed order (the store's own, as before). The dev perf counter `core::store::count` counts the size reads this decision makes.
- **Breaking** for a custom `Store`: the interface gains `count(documentId)`, the number of records a document holds, read without reading the records; an implementation may cache it in step with its own writes. The in-memory store and the local (Dexie) store implement it, the latter cached until its next write to the document.

## [0.6.2] - 2026-10-16

### Changed

- `getAttribute` and `getAttributes` (their `fullObject` forms too) read a record given in full - a `RawRecord`, `TrackedRecord` or `TreeRecord` - as it is, with no store round trip; a ref or a relationship is still fetched. Inside a transaction the staged operations still come first, so a record held from before a staged write reads as the transaction sees it and one deleted in the transaction reads as absent. Outside a transaction the record is a snapshot: a record held across a commit no longer picks that commit up through these reads - pass `toRef(record)` to read the store again. The dev perf counter `core::query::getRecord.fromRecord` counts the reads served from the record given.

## [0.6.1] - 2026-10-14

### Added

- `isNamespaceAllowedByWildcard` in `@dialecte/core/utils`: whether an element's attribute wildcard allows a namespace.

### Fixed

- `assertValidXml` (`createXmlSchemaAssertions`) checks the attributes of every namespace, not only unprefixed ones: an attribute of a namespace the dialecte declares is looked up under the dialecte's prefix, whatever prefix the document binds (`x:unknown` reports `'ext:unknown'`), and one of a foreign namespace is reported too. An attribute the element's wildcard allows passes (`##other`, `##any`, a namespace list) - the wildcard was ignored, so an unprefixed attribute under `##any` was reported. Namespace declarations, `xsi:*` and the test record id are always allowed. A fixture carrying an attribute its element does not declare now fails.

## [0.6.0] - 2026-10-14

### Added

- **A `beforeCommit` transaction hook** (also in 0.5.4). Called once per transaction when its callback is done (`document.transaction` and `document.prepare`, so a preview shows what it adds), with every staged operation and a query that reads them. It returns operations to stage, which call no hook again.
- A declaration's definition may say its declared type, `type` (its Clark name), when the type is named - as `@dialecte/create` writes it from its next release on.
- `resolveXsiType` (the type a record names), `canonicalXsiType` (the form core stores a value in) and `admittedXsiTypes` (the types an element may name) in `@dialecte/core/utils`.
- `addChild` and `ensureChild` take every attribute the dialecte declares in their value-object form, under the name it is stored by - `xsi:type` and namespaced ones included (`{ aShape: 's', 'xsi:type': 'tCircle', 'ext:cShape': 'c' }`): what `getAttributes` returns is written back as is. A prefix no namespace of the dialecte has throws `UNKNOWN_NAMESPACE_PREFIX`; the array form stays for a namespace given by key or one the dialecte does not declare.
- Read the values a datatype enumerates and its patterns per level with `enumeratedValues` and `valuePatterns` from `@dialecte/core/utils`.
- Elements can name a type with `xsi:type`: a declaration lists the types it admits in `variants`, and says `abstractType` when one must be named.

### Changed

- **Breaking:** `getAttributes(record)` without a `namespace` returns every attribute under the name it is stored by: a namespaced one as `prefix:local`, `xsi:type` included; it returned the default-namespace attributes only. Destructuring is unaffected; code iterating the object sees the namespaced attributes too (their keys carry a prefix).
- **Breaking (types):** `DefaultAttributesValueObjectOf` is removed - the value-object forms are `AttributesValueObjectOf`; `DefaultAttributeNamesOf` remains for the array form.
- **Breaking:** writes check the type an element names with `xsi:type`: `XSI_TYPE_REQUIRED` (`D3009`) where its declared type is abstract and none is named, `XSI_TYPE_NOT_ADMITTED` (`D3010`) for a type it may not take, `XSI_TYPE_CHANGE_LEAVES_CONTENT` (`D3011`) for an update naming another type while attributes or children that type does not admit remain - named in the error. Import never refuses.
- **Breaking - one stored form of an `xsi:type` value.** Import and every write store the local name for a type in the dialecte's default namespace, the dialecte's prefix and the local name otherwise; export writes that form. A value core cannot read (a prefix bound nowhere, a namespace the dialecte does not declare) is kept as written.
- **Breaking:** `matchesAttributeFilter` takes the `dialecteConfig`; `parseOmit` takes `{ omit, dialecteConfig }`; `applyOmit` takes a `dialecteConfig`.
- Filters (`findByAttributes`, `findDescendants`, `getTree` `where`, `omit`, `ensureChild`) compare `xsi:type` as the type it names, written as a local name, with the dialecte's prefix or as a Clark name.
- **Breaking (types):** for a dialecte generated by `@dialecte/create` from its next release on, an element that may take another type is a union on `'xsi:type'`. A filter is typed per member: an attribute only a variant has needs no type named, and is refused beside a type that does not have it; `'xsi:type'` takes one type, several, or a variable holding one of several. Any part of an element's value object is a filter too, in code generic over the element included; an element taking no other type keeps the one flat filter it had. A write names one member: an abstract type's element names its type (`attributes` required on `addChild`), a concrete one may omit it. `AttributesOf` reaches every member's attributes. The typed values are the stored literals: another form of the same type is a compile error, still resolved at runtime.
- **Breaking:** Regenerate your dialecte with `@dialecte/create` 0.1: core reads only the definition it writes.
- **Breaking:** A tag declared several ways lists each way under `declarations`, and its tag level keeps only what every way agrees on.
- **Breaking:** A parent names the way of each child it holds, and element particles carry their namespace and that way; edges no longer copy attributes, children or constraints.
- **Breaking:** An attribute's or a text's facets live in its `type`, with patterns grouped per derivation level and written for the `u` flag.
- **Breaking:** Identity constraints sit on the declaration that declares them, with namespaced selector and field steps and `refer` as `{ name, namespace }`.
- **Breaking:** `attributes.any` is a wildcard object (`namespace` or `notNamespace`, with `processContents`), and `anyNamespace` is gone.
- **Breaking:** Pass the generated `TYPES` as `DialecteConfig.types` and to `createXmlSchemaAssertions`.
- **Breaking:** `resolveDefinition` and `query.getDefinition` return the declaration that applies to the record, following its parent and its `xsi:type`.

### Fixed

- `getAttributes` returns `xsi:type`: it was typed in the value object but dropped at runtime, so a check of `attributes['xsi:type']` never matched.
- An attribute of a namespace the dialecte declares is stored under the dialecte's prefix, whatever prefix the document bound to that namespace: `x:cA`, with `x` bound to the namespace the dialecte calls `ext`, was stored as `x:cA`, so `getAttribute('ext:cA')`, filters and updates by `ext:cA` missed it.
- Value objects leave the document's namespace declarations out: `getAttributes` returned a parsed `xmlns:foo` as an attribute `foo`.
- `update` takes an attribute of a namespace the dialecte does not declare by the name it is stored by (`'foo:bar'`): it threw `UNKNOWN_NAMESPACE_PREFIX` although the record holds its namespace.
- `assertValidXml` (`@dialecte/core/test`) finds a required attribute of a dialecte namespace written under another prefix than the dialecte's: it reported it missing.
- An `xsi:type` whose prefix a document binds on an ancestor only is read: the attributes of the type it names were dropped on import.
- Export declares the namespace an `xsi:type` value uses: a type outside the default namespace was written with an unbound prefix.
- An attribute only an `xsi:type` variant declares keeps its namespace when written in the value-object form.
- A fixed value set by an update that also names another `xsi:type` is judged on the new type: it was judged on the old one.
- An attribute in no namespace that the element's wildcard admits is kept on import and create instead of being dropped.
- An element read in a namespace none of its declarations uses keeps it, so export writes back the document that was read.
- Each declaration keeps its own identity constraints instead of taking those declared under another parent.

## [0.5.4] - 2026-10-14

### Added

- **A `beforeCommit` transaction hook.** Called once per transaction when its callback is done (`document.transaction` and `document.prepare`, so a preview shows what it adds), with every staged operation and a query that reads them. It returns operations to stage, which call no hook again. For a rule that needs the whole transaction: `afterCreated` runs as soon as a record is added, before a copy or a caller adds its children.

## [0.5.3] - 2026-10-06

### Added

- `defineErrors` declares the errors of a dialecte. `throwDialecteError` and `invariant` accept them like core keys. A key or a code that clashes with the core catalogue is refused.
- `meta` on `throwDialecteError` and `invariant`: data about the error, read back on `DialecteError.meta`.
- `toDialecteError(thrown)` reads the structured error out of a caught value.
- `isKnownDialecteError(error, { catalogues })` narrows `error.key` to the core keys and the keys of the catalogues given.
- `createDialecteError` builds a structured error without throwing it.

### Fixed

- A structured error thrown inside `doc.transaction` or `doc.prepare` reaches the caller unchanged, instead of being reported as `UNKNOWN`.
- `doc.state.error` is set when a transaction fails.
- `DialecteError.method` names the function that failed, not `invariant` or an internal helper.

### Changed

- `DialecteError.key` and `.code` also accept the keys and codes a dialecte declares. Use `isKnownDialecteError` to get a closed key type back.

## [0.5.2] - 2026-10-01

### Added

- An `afterImport` update can drop attributes: list their names in `removeAttributes` on the `RecordPatch`. It is applied after the attribute merge, in both stores.

## [0.5.1] - 2026-09-29

### Fixed

- A package using `@dialecte/core` type-checks without `skipLibCheck`: the XML parser's types (`@types/sax`) ship with it, and `dexie` 4.4.6 declares its types the way current TypeScript expects.

## [0.5.0] - 2026-09-28

### Added

- Read an element as declared under its parent: `resolveDefinition({ dialecteConfig, record })` and `query.getDefinition(refOrRecord)`. Attribute reads, the `fixed` guard, standardization and export follow it.
- The attribute types take an optional parent (`AttributesOf<Config, 'AAA_1', 'AA_2'>`); `addChild` and `ensureChild` use it, so an attribute not declared under that parent no longer compiles.
- Definition types for what the generator now emits: `type` on attributes and text, `contentModel`, `nillable`, `anyNamespace`, text `default` / `fixed`.
- `afterDelete` transaction hook: fires once per deletion root after the subtree and the parent update are staged, with the deleted `record`, the staged `parentRecord` and `query`. Returned operations are staged.

### Changed

- `config.attributes` is `{ byTag, byParent }`: regenerate the definition with the latest `@dialecte/create`, and read `ATTRIBUTES.byTag[tag]` where you read `ATTRIBUTES[tag]`.
- `getAttributeRules`, `resolveSchemaAttributeValue`, `isSchemaDefaultValue` and `assertNoFixedViolation` take the `record` instead of its `tagName`.

### Removed

- `ChoiceGroup` and `children.choices`: read the `choice` nodes of `contentModel` instead.

## [0.4.17] - 2026-09-21

### Added

- **`createXmlSchemaAssertions` test helper** (`@dialecte/core/test`). Structural fixture validator bound to a dialecte's generated `DEFINITION` + `namespaces`: `assertValidXml(xml)` fails a fixture whose element namespace, containment or attributes don't match the schema (content unknown to the schema, or in a namespace the dialecte doesn't declare, is skipped), and `assertValidXmlTestCases` reports every invalid case at once. Extracted from scl's own test harness so every dialecte shares one validator.

## [0.4.16] - 2026-09-17

### Added

- **`formatXml` / `formatEmbeddedXml` utils** (`@dialecte/core/utils`) and a **`dialecte-xmlfmt` bin**. `formatXml` reindents an XML string to one structural tag per line with text leaves inline; it is NON-VALIDATING and tolerant of `${...}` template interpolations, which is why it is safe on XML embedded in JS/TS template literals — a real XML parser silently mis-parses a whole-attribute interpolation like `${templateUuid}` and drops the element. `formatEmbeddedXml` applies it to every `/* xml */`-marked template literal in a JS/TS source string (closing backtick aligned to the statement); the `dialecte-xmlfmt` bin runs it over a glob (`--check` for CI), so a consuming package formats its fixtures with no wrapper script.

## [0.4.15] - 2026-09-17

### Added

- **`normalizeUuids` test helper** (`@dialecte/core/test`). Rewrites every uuid value in a serialized document to a stable first-appearance token (`uuid-1`, `uuid-2`, …) — the same uuid always maps to the same token, so lineage (a `templateUuid` pointing at an element's `uuid`, a reference's target) stays visible. Lets a snapshot freeze structure + lineage without mocking `crypto.randomUUID` (`expect(normalizeUuids(xml)).toMatchSnapshot()`), immune to uuid ordering or a leaked mock.

### Fixed

- **Flaky `ConstraintError: Key already exists in the object store` in tests using `runTestCases`.** The `crypto.randomUUID` mock swapped in during a test's `act()` was never restored on completion, only reset by the _next_ wrapped test — so a plain `it()` running afterward in the same file could inherit the leaked low-entropy counter, collapsing test project db names down to near-collision-prone values under parallel execution. `crypto.randomUUID` is now always restored in the test's `finally` block.

## [0.4.14] - 2026-09-16

### Changed

- **`getTree`/`getSnapshot` staged-write overlay resolves via the maintained id index instead of replaying the full staged log.** For a full-document read (`getTree` with `depth: undefined`, or a snapshot), the `live` result is now built from `stagedOperations.byId` — the same last-write-wins result as before, without revisiting every historical operation for an id staged more than once in a transaction. The `includeDeleted` tombstone path (which needs the full ordered log to exclude create+delete-in-the-same-set no-ops) is unchanged. No API change.

## [0.4.13] - 2026-09-10

### Added

- **`getTree({ depth })` — expand only part of a tree.** Pass a `depth` to load just the levels you need (`undefined` = full tree, the default; `0` = the node alone; `1` = node + direct children; …). A collapsed node keeps its `children` refs but returns an empty `tree`, so you can tell a collapsed branch from a leaf — ideal for lazy, expand-on-demand UIs. A bounded read only touches the levels it needs (via the new `Store.getMany`), so a shallow expand stays fast on large documents. Inside a transaction with pending writes it reads the whole document so staged changes still show.

### Changed

- **Staged writes no longer slow down as a transaction grows.** A big `deepClone` or a bulk delete used to get slower with every change staged; reads now use a maintained id-index, so a transaction stays fast whatever its size. Behaviour is unchanged.
- **`getTree` reads the document once instead of once per node.** A full tree is now built from a single read assembled in memory — much faster on large documents, with the same `select`/`omit`/`unwrap`/ordering behaviour and no API change.
- **Faster XML parsing for large files.** Two fixes in the import pipeline — no longer re-copying the buffer on every chunk, and no longer rebuilding the parser's state on every element — make large files parse substantially faster. (Overall import also depends on the database write step, which this change doesn't touch.)

## [0.4.12] - 2026-09-07

### Added

- **`tx.progress` — two-level progress via a plan stack.** `plan({ steps, label? })` pushes a level, `nextStep(label?)` advances it (close-previous: `current` = completed steps), `endPlan()` pops. Main plan drives the `current`/`total` bar; the deepest nested plan drives the `step` sub-bar + caption. Balance each `plan()` with `endPlan()` — except the transaction's main plan, which `forceClear()` closes for you. Reads get a no-op reporter.
- **Dev perf helper** (`createPerf`, only when `dev.perf` is on). User-Timing spans under a `dialecte::` root, read synchronously via `perf.report()` → `{ calls, totalMs, avgMs, count? }`; a frozen no-op with zero prod cost when off. Exposed as `doc.perf` / `tx.perf` / `ctx.perf`. See `doc/guide/development/dev-perf.md`.
- **`perf.count(name)`** — tally events (round-trips, cache hits/misses) without a span; surfaced as `count` in `report()` and cleared by `reset()`.
- **Dev instrumentation spans + counters** across the hot paths (all gated by `dev.perf`, no-op when off): import (`core::import`, `::sax`, `::resolveChildren`, `core::store::bulkWrite`), commit (`core::commit`, `::merge`, `core::store::commit`), clone (`core::deepClone`), and query primitives (`core::query::getRecord.cacheHit`/`.miss`, `core::store::get`, `core::store::getByTagName`).

### Fixed

- `addChild`/`deepClone` no longer throw `PREFIXED_ATTRIBUTE_NAME` for a namespaced attribute whose prefixed `name` already agrees with its `namespace` — the canonical form every stored attribute carries. Previously any clone of a subtree containing a namespaced attribute (e.g. a vendor `Private` extension) failed this check, since `deepClone` replays already-standardized attributes through the same param shape as authored input. The guard still rejects a genuinely ambiguous authored name (prefixed with no `namespace`, or a `namespace` whose prefix conflicts with it).

## [0.4.11] - 2026-09-03

### Removed

- **Breaking:** removed the `afterDeepClone` transaction hook. It ran once after each clone with the mappings accumulated across the _entire_ transaction, driving a post-clone pass whose cost grew with the number of cloned elements — a measurable bottleneck on large clones (e.g. importing big type closures). `deepClone` is now purely structural and simply returns the source→target `CloneMapping[]` for that call; staging any follow-up is the dialecte's responsibility, over just the pairs it needs. Nothing is lost — the work moves from a core hook to the caller.

## [0.4.10] - 2026-07-28

### Added

- Type-performance dev guide (`doc/guide/development/type-performance.md`): how to use the `dialecte` CLI (coverage / bench / narrowing / audit), how to read `baseline.json` and `readability-audit.md`, and what the two CI gates catch.

### Fixed

- `state.progress` is now cleared to `null` after a **successful** commit (previously it was reset only on error). It no longer lingers as a stale `Committing changes...` value between operations, so a consumer reading `state.progress` while the document is idle correctly sees `null`.

## [0.4.10] - 2026-07-27

### Changed

- update to latest vitest packages

## [0.4.9] - 2026-07-27

### Fixed

- `Project.destroy()` / `close()` no longer race with channel work: a commit could touch the store after teardown, throwing `DatabaseClosedError` / `ConstraintError`. Each project now uses a single BroadcastChannel and never re-derives its own state from a self-echo — local mutations maintain state inline (a commit refreshes `canUndo` / `canRedo` synchronously), and the listener folds in only messages from other tabs / iframes. `destroy()` drains any in-flight foreign-message work before deleting the store. No public API change.

## [0.4.8] - 2026-07-24

### Added

- `widen` (`@dialecte/core/helpers`): overloaded, pure-identity widener that upcasts a `TreeRecord` / `TrackedRecord` / `RawRecord` / `Ref` / `Attribute` from a specific element to the config's element union. The config is inferred from the argument, so callers write `widen(thing)` cast-free — a single sanctioned place for the widening TypeScript cannot verify on invariant element params.

## [0.4.7] - 2026-07-23

### Added

- `getSnapshot`: `includeXmlDeclaration` option (default `true`) — set `false` to omit the XML prolog (`<?xml version="1.0" encoding="UTF-8"?>`) from `as: 'xml'` / `'both'` output, e.g. for an excerpt embedded in another document.

## [0.4.6] - 2026-07-21

- Add generic `ExtendedDocument` type for local extension

## [0.4.5] - 2026-07-21

### Added

- **Attributes rework — one `defaults` option: `none | optional | required`.** Every read (`getAttribute` / `getAttributes`, including `{ fullObject: true }`) takes it, so you pick the view you need: `none` = exactly what's stored, `optional` = schema `fixed` / `default` filled in (the default), `required` = the XSD/export view (required + fixed). Backed by `resolveSchemaAttributeValue` in `@dialecte/core/utils`. Note: `{ fullObject: true }` now returns the `optional` view — pass `defaults: 'none'` for the stored-only set.
- **Cross-realm document readiness.** `Project.getDocumentStatus()` plus `Store.reconcile` / `Store.isDocumentReadable` let a document imported in another JS realm (e.g. an iframe) open without a broadcast race. **Breaking for custom stores: both `Store` methods are now required.**
- **`FIXED_VALUE_VIOLATION` (`D3008`).** Writing a value that contradicts a schema `fixed` now throws; import stays lenient.

### Changed

- **Faithful store** — supersedes the earlier "fill on import, strip on export" model (see 0.1.16 / 0.2.11 / 0.3.0). The store now holds exactly what the author wrote: import keeps attributes verbatim and drops empty (`''` / `undefined`) values; schema `required` / `fixed` / `default` are no longer baked into storage. They reappear where they belong — filled on read (`optional`) and materialized on export (`required` + `fixed`) — so import → export round-trips without inventing attributes.

### Fixed

- Import no longer standardizes an element whose local name matches a schema element but whose namespace the config does not declare. Such foreign-namespace records now pass through verbatim (namespace + attributes kept) instead of being coerced to the schema namespace. Standardization is gated on the namespace uri.

## [0.4.4] - 2026-07-17

### Added

- `getAttribute` / `getAttributes`: optional `namespace` scope (registered key or raw prefix) to read namespaced attributes by local name — `getAttributes(ref, { namespace: 'ext' })` returns local-keyed values. Unscoped `getAttributes(ref)` now returns default-namespace attributes only (`{ fullObject: true }` for the full set). Per-element IntelliSense.
- `addChild` / `ensureChild`: author namespaced attributes via `{ name: <local>, value, namespace }` (`namespace` = registered key string or `{ prefix, uri }`); the value-object form is for default-namespace attributes.
- `PREFIXED_ATTRIBUTE_NAME` (`D3007`): thrown when an authored attribute name carries a prefix.
- Helper types: `AttributeInputOf`, `NamespaceKeysOf`, `NamespaceKeysUsedByElement`, `DefaultAttributesValueObjectOf`, `NamespacedAttributesValueObjectOf`, `LocalAttributeNamesInNamespace`, `DefaultAttributeNamesOf`, `PrefixOfNamespaceKey`.
- `@dialecte/core/utils`: `resolveNamespaceByScope`, `resolvePrefixByNamespaceScope`.

### Changed

- `query.getFilename()` → `query.getDocumentInfo()`: now returns the full document metadata record (`id`, `name`, `extension`, `configKey`, `createdAt`, `metadata`) instead of only the filename. Async; throws `DOCUMENT_NOT_REGISTERED` if the document is not registered.

## [0.4.3] - 2026-07-17

### Added

- `getSnapshot`: `declareNamespaces` option (default `true`) — set `false` for a bare XML fragment (no `xmlns` declarations).
- Extension groups (`query`/`transaction`) can now nest to arbitrary depth (e.g. `a.aa.getItems`), with binding/types/intellisense preserved; flat modules keep working unchanged.

## [0.4.2] - 2026-07-09

### Changed

- update to typescript 7

### Fixed

- `getRecord`: throws `ELEMENT_TAGNAME_MISMATCH` when a record found by id has a different tagName than the ref (previously only id was validated). Consistent with the staged-lookup path.

## [0.4.1] - 2026-07-09

### Fixed

- `stageEnsureChild`/`ensureChild`: lookup is now always scoped to `parentRef` via `getChildren`.

### Changed

- `AddChildParams.attributes` (used by `addChild`/`ensureChild`) now optional if there is no required attributes

## [0.4.0] - 2026-07-07

Reworks core reactivity around the project `BroadcastChannel`: one shared per-document state, one channel fold for every mutation source (local, cross-tab, undo/redo), and maintained `canUndo`/`canRedo` flags.

### Added

- `ProjectChannelMessage`: exported discriminated union typing every message on the project channel (`commit`, `init-empty-document`, `document-removed`, `document-imported`, `blob-*`) — the public event contract. Every payload now carries a `timestamp`.
- `project.channelName` / `document.channelName` + `project.createChannel()`: open your own channel instance to receive every project event, same-tab and cross-tab.
- `Store.getHistoryStatus(documentId)`: reports `{ canUndo, canRedo }` from the changelog head (implemented by `DexieStore` and `InMemoryStore`). `DocumentEntry.canUndo`/`canRedo` are now maintained from it — on `open()`, after `undo()`/`redo()`, and on every commit (local or cross-tab).

### Changed

- Shared reactive state: `Document.state` is the Project's `DocumentEntry` for that documentId, shared by every Document of the same file and by `project.state.documents`. Commits (and `undo()`/`redo()`, which previously updated nothing locally) are visible in project state synchronously.
- Single channel fold: a dedicated listening channel subscribed via `addEventListener` receives every message — including this tab's own posts — and folds it into project state. Replaces the shared-instance `onmessage =` assignment, where each `openDocument()` silently clobbered the Project's and other Documents' handlers and same-tab delivery never worked.
- **Breaking:** `Document` constructor — the trailing `channel: BroadcastChannel` parameter is replaced by `{ state, channelName, notify }`, provided by `Project.openDocument()` (its only call site; no known subclasses).
- **Breaking:** `Store` implementations must add `getHistoryStatus(documentId)`.

## [0.3.0] - 2026-07-02

### Added

- Standardization now runs at **every** record entry point — `project.import` (per parsed element), `initEmptyDocument`, and `update`, not just `addChild`/`deepClone` — so the store holds one canonical form regardless of how a record was produced. It fills required / `fixed` / `default` attributes, applies a deterministic attribute order (re-applied after the `afterStandardizedRecord` hook), and skips no-op updates. Removes false "updated" diffs from standardization-only differences.
- `DialecteHooks<Config>` (`IOHooks & TransactionHooks<Config>`): every lifecycle hook as one flat, fully-typed object on the `Project` instance (`new Project({ hooks })`) — no cast, no `any`.
- Canonical namespaced-attribute naming across all entry points: a default-namespace attribute is keyed by its bare local name (`aA`, `root`); any non-default one by `prefix:local` (`ext:root`). Collision-safe — a prefixed name never clashes with a bare one (`root` and `ext:root` coexist on one element) — so a namespaced attribute reads and writes under a single name.
- Per-parent-context element namespaces: the generated definition carries a namespace on the parent→child edge (`ChildDefinition.namespace`), so a local name declared in more than one namespace serializes correctly under each parent (falling back to the element's own namespace).
- `UNKNOWN_NAMESPACE_PREFIX` (`D3006`): thrown when writing an attribute in a namespace the config does not declare — pass it explicitly as `{ name, namespace: { prefix, uri } }`.
- `@dialecte/core/utils`: `getAttributeRules`, `orderAttributesBySequence`, `compareQualifiedAttributes`, `extractLocalName`, `resolveNamespaceByPrefix` — the shared attribute/namespace foundation reused by both `standardizeRecord` and XML export.

### Changed

- **Breaking:** lifecycle hooks are provided on the `Project` instance instead of the config. `beforeImportRecord` now runs **after** standardization and receives the finalized record (canonical attributes + any hook-enforced `uuid`).
- **Breaking:** imported non-default-namespace attributes are stored under their `prefix:local` name (previously the bare local name), matching created records and the generated schema keys — fixes value corruption when standardizing such attributes on import.

### Removed

- **Breaking:** `config.hooks` and `config.io.hooks` — hooks moved to the `Project` instance.

## [0.2.22] - 2026-06-29

### Fixed

- `withAllExtensions`: deep-merge extension groups instead of shallow `Object.assign`, so a namespace registered in both `query` and `transaction` no longer loses its query methods when the transaction group is applied.

## [0.2.21] - 2026-06-29

### Added

- `Query.getSnapshot(options?)`: render the current document state — including a transaction's uncommitted changes — as a tree, XML string, or both (`as: 'tree' | 'xml' | 'both'`). Scope with `ref`/`ancestors`/`siblings`/`depth`; shape the tree with `omit`/`unwrap`/`includeDeleted`. `siblings` includes each ancestor-spine node's siblings — `true` for shallow context, `{ expand: true }` for full subtrees. `depth` is honored even without a `ref` (e.g. `{ depth: 1 }` is the root plus its direct children). The XML always reflects the full document (what `commit()` writes); a scoped non-root `ref` yields an XML fragment. Reachable on a live transaction and on `PreparedTransaction.query`.
- `PreparedTransaction.query`: read-only `Query` view of the in-progress transaction, for previewing staged changes (e.g. `getSnapshot`) before `commit()`.
- `buildXmlDocument` accepts `rootId` to build a fragment rooted at a non-root element (document-root attribute enforcement is skipped for fragments); `xmlDocumentToString` exported from `@dialecte/core` xml build.
- Test runner (`@dialecte/core/test`): `ActResult` supports `assertOn: 'custom'` with an `xmlString`, running `expectedQueries`/`unexpectedQueries` against XML produced inside the act (e.g. a `getSnapshot` output) instead of the stored export.

### Changed

- `getTree` and `getSnapshot` now return children in **config order** (`config.children[parent]` sequence, unknown tags last) instead of stored/document order, so a tree matches its XML serialization. The ordering comparator (`orderByConfigSequence`) is shared with `buildXmlDocument` as the single source of truth.
- `getTree`'s `omit`/`unwrap` logic moved to a shared tree-filter module now also used by `getSnapshot` (no behavior change for `getTree`).

## [0.2.20] - 2026-06-26

### Added

- Type-performance dev guide (`doc/guide/development/type-performance.md`): how to use the `dialecte` CLI (coverage / bench / narrowing / audit), how to read `baseline.json` and `readability-audit.md`, and what the two CI gates catch.

## [0.2.19] - 2026-06-10

### Fixed

- add `xmlns` key name on xmlns attribute (was empty before)

## [0.2.18] - 2026-06-10

### Added

- `xsi` namespace string to be consumed in xml string

## [0.2.17] - 2026-06-10

### Added

- `XSI_NAMESPACE` constant (`{ uri: 'http://www.w3.org/2001/XMLSchema-instance', prefix: 'xsi' }`) exported from `@dialecte/core/helpers`
- `inspectXml`: lightweight SAX-based XML inspector; stops early once all requested elements are found; returns typed report of attributes, children, and text value per element
- `DIALECTE_NAMESPACES` (`{ dev, xsi }`) exported from `@dialecte/core/helpers` - groups the two framework-level namespace descriptors as a ready-to-spread base for dialecte config `namespaces` objects
- `IOHooks` type and `IO_HOOKS` export pattern: dialecte packages expose a named `IO_HOOKS` constant (conforming to `IOHooks`) that is passed as `io.hooks` in their dialecte config; currently supports `beforeImport` for normalizing raw XML before parsing

### Changed

- `DIALECTE_NAMESPACES` in `@dialecte/core/test` renamed to `DIALECTE_TEST_NAMESPACES`; derives from `DIALECTE_NAMESPACES` (helpers) and adds `default` + `ext` test-only namespaces. Import path unchanged (`@dialecte/core/test`).

## [0.2.16] - 2026-06-03

### Fixed

- Test helpers: `TestDocument`, `TestProjectResult` and `ActParams` now propagate the `GenericModules` generic so `source.query` / `target.query` expose bound extension namespaces (e.g. `source.query.dataModel.*`) in dialecte test suites.

## [0.2.15] - 2026-06-03

- packages major version update

## [0.2.14] - 2026-06-02

### Added

- Blob storage: attach binary files (PDFs, images, etc.) to a project, document, or specific record
  - `Project` API: `addBlob`, `getBlob`, `getBlobsByDocument`, `getBlobsByRecord`, `getStandaloneBlobs`, `attachBlob`, `detachBlob`, `removeBlob`
  - `Store` API: matching low-level methods on the `Store` interface
  - Storage layout: shared `_blobs` registry table + per-document `blob_{documentId}` data tables (mirrors `record_{documentId}` partitioning); cleaned up with the owning document
  - Types: `BlobRecord`, `BlobAttachment` (logical refs via `attachedTo: { documentId, recordRef, attribute? }[]`; empty array = standalone project blob)
  - BroadcastChannel events: `blob-added`, `blob-attached`, `blob-detached`, `blob-removed`
- `Project.exportBlob(blobId, { withDownload? })`: fetch a blob and optionally trigger a browser download. Mirrors `export(documentId, { withDownload })` for binary attachments. Returns `{ entry, data, filename }`.
- `exportBlob` standalone function exported from `@dialecte/core` with `ExportBlobParams` / `ExportBlobOptions` / `ExportBlobResult` types.
- `saveToDisk` utility (`@/utils`): browser-only blob-to-disk helper (File System Access API with anchor download fallback). Extracted from `downloadFile` and reused by both `exportDocument` and `exportBlob` download paths.
- Public export: `bindExtensions` (binds an extension map to a `Query`/`Transaction` instance)
- Error codes: `STORE_BLOB_NOT_FOUND` (D1008), `UNIQUE_CONSTRAINT_VIOLATION` (D3005), `BLOB_NOT_FOUND` (D7004)

### Changed

- `downloadFile` (XML download path) now delegates the picker / anchor logic to the shared `saveToDisk` utility. Behavior unchanged.
- `QueryExtensionFn` / `TransactionExtensionFn` are now generic over their first argument (defaulting to `any`) to handle TypeScript parameter contravariance when extension authors annotate the concrete `Query`/`Transaction` type. Type safety at the call boundary is recovered via `BoundExtensionMap` + new exported `OmitFirstArg` helper.

## [0.2.13] - 2026-06-01

### Changed

- `getTree`: transparent elements (from `transparentElements` config) are now handled automatically - fetched through any `select` filter and auto-unwrapped from the result; explicit entry in `select` or `unwrap: []` overrides this behavior

## [0.2.12] - 2026-05-22

### Added

- `InMemoryStore`: Map-backed `Store` implementation with `{ type: 'inMemory', writable?: boolean }` storage param
- `STORE_NOT_WRITABLE` error code (D1007): thrown when mutating a non-writable in-memory store

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
