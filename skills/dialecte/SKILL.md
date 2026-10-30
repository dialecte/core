---
name: dialecte
description: Work with Dialecte, the XSD-to-typed-DSL engine (@dialecte/core plus a dialecte package - one published under @dialecte or one generated from your own XSD) in application code - open a Project, read with doc.query, write with doc.transaction, import/export XML, add a custom extension, write table-driven tests. It gives the mental model (core engine / generated definition / dialecte hooks + business extensions / your app), the reuse ladder to run before writing any helper, and the traps that make code slow or wrong. Use it whenever code imports @dialecte/*, touches records, refs, getAttributes, getTree, findDescendants, addChild, deepClone, hooks or run*TestCases, or the user mentions dialecte, even for a small read. To change dialecte itself use dialecte-contributing; for a dialecte's own business verbs use that dialecte's skill (dialecte-<id>, shipped with its package); to generate a dialecte from an XSD use dialecte-create.
license: MIT
metadata:
  author: dialecte
  version: '0.1.0'
---

<!-- dialecte-skills ignore: doc.query.inventory.lowStock tx.inventory.restock project.state doc.state doc.query.myFeature.findOrphanParts -->

# Dialecte (using it)

Dialecte turns an XSD into a typed DSL over XML documents stored in a database. Almost every "I need
a function that does X with these records" already exists somewhere in its layers, and the most
common failure is writing it again: a local `toRef`, an attribute finder, an ancestor walk, a
uuid/name fix-up that a hook already performs on every write. This skill exists to stop that.

## The mental model: four layers, each owns something

```
your app            custom extensions, services, UI           (yours)
dialecte package    @dialecte/<id>, @acme/widget              (domain)
  ├ definition/*.generated.ts   generated from the XSD - never edited by hand
  ├ config/                     wires the definition into core, `namespace <Name>` types
  ├ hooks/                      automatic coherence on every write and on import
  ├ extensions/<ns>/            business verbs: doc.query.<ns>.<verb>(), tx.<ns>.<verb>()
  └ test/                       run<Name>TestCases, XML validators for fixtures
@dialecte/core      schema-agnostic engine: Project, Document, Query, Transaction,
                    records + refs, hook dispatch, XML import/export, stores, errors, test runner
```

- **Core knows no domain.** It never contains the rules of any schema. A domain rule lives in the
  dialecte package; an app-only rule lives in the app.
- **The definition is the source of truth** for which elements, attributes, children, parents,
  defaults and types exist. From app code read it through the package's config
  (`<NAME>_DIALECTE_CONFIG.children / parents / attributes / descendants / ancestors`) or
  `query.getDefinition(ref)`, instead of writing a list by hand.
  TypeScript types are generated from it, so the compiler already rejects an invalid child or
  attribute.
- **Hooks keep a document coherent automatically.** If the dialecte has an `afterCreated` hook that
  fills reference paths, your code must not fill them too. Know the hooks before writing any write.
- **Extensions are the dialecte's business API.** They are bound onto every query and transaction:
  `doc.query.inventory.lowStock(...)`, `tx.inventory.restock(...)`.

## Step 0: is this skill your version's?

This skill ships inside `@dialecte/core` and describes the core it ships with (0.8). If your project
pins another core, read the skill of that version (`npx @dialecte/cli skills sync` installs the one
matching your `node_modules`) and confirm signatures in its `.d.ts`.

## Look it up with the cli first: one command each

`@dialecte/cli` (0.2 or later, run as `npx @dialecte/cli <command>`) answers from what is installed -
the same with or without the repositories - in a few lines (`--json` for more). Run these before
reading `node_modules`, the sources or the docs:

| You need                                                        | Run                                            |
| --------------------------------------------------------------- | ---------------------------------------------- |
| your versions, and whether this skill is theirs (Step 0)        | `npx @dialecte/cli doctor`                     |
| a method for what you are trying to do (reuse ladder, rung 2-4) | `npx @dialecte/cli api find "<what you need>"` |
| its exact contract: signature, summary, routes, one call        | `npx @dialecte/cli api show <route>`           |
| what a group holds, your own extensions included                | `npx @dialecte/cli members <expression>`       |
| what an element may hold: parents, children, attributes         | `npx @dialecte/cli schema <Tag>`               |

- A `⚠️` line of `doctor` comes first: it names the command that fixes it.
- Search by the words of your need, not by a name you imagine:
  `npx @dialecte/cli api find "copy a subtree from another document"`. The best match is first; read the
  `api show` of every close one before ruling it out.
- `schema` reads the installed definition through core's own readers: never list children or required
  attributes by hand, never parse `definition.generated.ts` or the XSD.
- Exit 1 means nothing found (or a warning): fall back to the sources below, in their order.

## Where the truth for your installed version lives

This skill describes shapes and rules, not exact signatures. Before calling or citing any method,
confirm it in this order:

1. The repo, if it is checked out locally (sibling folder, `$DIALECTE_ROOT`): `src/` of the package,
   at the version you run.
2. The installed build: `node_modules/@dialecte/<pkg>/dist/**/*.d.ts` (exact for your version).
3. The published docs, index first then the one page you need:
   `https://dialecte.github.io/core/llms.txt` and the one each dialecte package publishes
   (`https://dialecte.github.io/<package>/llms.txt`; `llms-full.txt` only for a cross-API search). Docs describe the latest release.

Never invent a signature. If the three disagree, the code you actually run wins.

## The reuse ladder - run it before writing ANY helper, stop at the first hit

1. **Your app's own dialecte layer** (custom extensions, services). Someone may have written it.
2. **The dialecte's business extensions.** Each dialecte package ships a skill (`dialecte-<id>`)
   with `references/api.md`: an index of its verbs by intent ("label of an element", "copy a
   subtree from another document"), generated from the JSDoc. Search it by what you are trying to
   do, not by a method name you imagine.
3. **The dialecte's hooks.** "Whenever X is created/renamed/deleted/imported, also do Y" is a hook,
   and the dialecte may already ship it. Read the package's hooks doc before writing coherence code.
4. **Core Query / Transaction.** Traversal, lookup by attributes, trees, snapshots, add/ensure/
   update/delete/deepClone. Search [references/api.md](references/api.md) by what you are trying
   to do (generated from the JSDoc, intent table first); the shapes are in
   [references/core-api.md](references/core-api.md).
5. **Core and package helpers/utils** (`@dialecte/core/helpers`, `@dialecte/core/utils`, the
   package's own helpers): `toRef`, record converters, guards, `readAttribute(s)`, definition and
   attribute rules, namespaces, canonical ordering, `invariant`, XML formatting.
6. **Only then write it** - as a custom extension in the standard shape (below), not as a loose
   util. If every consumer of that dialecte would need it, it belongs in the dialecte package
   (propose it, see `dialecte-contributing`).

When you do write new code, say in your hand-off which rung you checked and why nothing fit.
A verb whose name or summary is close to your need is read in full (JSDoc and tests) before you
rule it out: names are short, behaviour is in the doc. Name what you ruled out and why.

## Core usage in five moves (every dialecte package ships `create<Name>Project`)

```ts
const project = await createWidgetProject({ storage: { type: 'local' } }).open('my-project')

const { documentId, diagnostics } = await project.importFile(file) // XML -> records, inside the store
// project.import(files) never rejects per file: it returns { status: 'imported' | 'failed' } entries
const doc = project.openDocument(documentId)

const query = doc.query // a new Query per access: take it once
const root = await query.getRoot()
const { name } = await query.getAttributes(someRef) // typed value object

await doc.transaction(async (tx) => {
	const part = await tx.addChild(assemblyRef, { tagName: 'Part', attributes: { name: 'P1' } })
	await tx.update(part, { attributes: { desc: 'spare' } }) // reads in tx see staged writes
}) // atomic commit, undoable

const { file, filename } = await project.export({ documentId }) // a formatted UTF-8 Blob, written by the store
// { xmlDocument: true } also answers the DOM, in the page only
```

Use the package's factory, not `new Project` / `createProjectFactory` yourself.

## Rules that keep code correct

- **All writes inside `doc.transaction(fn)`.** One at a time on this Document: a nested or
  overlapping one started on the same Document instance throws `CONCURRENT_TRANSACTION`. `doc.prepare(fn)` stages without committing (preview, then
  `commit()` / `discard()`).
- **Records are values.** Never mutate a record you got back; pass a ref or record to a method.
  Every public method accepts a ref (`{ tagName, id }`) or any record shape and normalises it with
  `toRef` - do not convert by hand.
- **Read attributes through the API.** With a query or tx at hand: `getAttributes(ref)` /
  `getAttribute(ref, { name })` (typed, sees staged writes). Without one (import pass, pure
  function): `readAttribute(s)` - a dialecte package may export one bound to its config (prefer
  it); core's takes `dialecteConfig`. Never `record.attributes.find(...)`. Absent vs empty:
  `{ defaults: 'none', fullObject: true }` gives `undefined` when absent.
- **Never build or parse XML by hand.** `project.import` / `project.export`; normalise input in
  the `beforeImport` IO hook.
- **Errors:** `throwDialecteError(key, {...})` / `invariant(cond, {...})`; a dialecte declares its
  own catalogue with `defineErrors`. No ad-hoc `throw new Error`.
- **State for UI** comes from `project.state` / `doc.state` / `doc.subscribe`, not parallel flags.

## Rules that keep code fast

Dialecte runs on large documents (hundreds of MB). A query hidden inside a per-element loop
multiplies.

- To climb, follow `record.parent` step by step and stop as soon as you know the answer.
  `findAncestors` only when you need the whole chain.
- No `findAncestors` / `getTree` / `getRecordsByTagName` / path building inside a per-element loop
  without a per-run `Map` cache keyed by id. Prefer reading the hierarchy once.
- Filter in the read, not after it: `findDescendants(ref, { collect: [{ Part: { where: { kind: 'spare' } } }] })`
  and `getTree(ref, { select: { where } })` take attribute filters - do not collect everything and
  filter in JS.
- `findDescendants` groups by tag and is NOT in document order; use `getTree` when order matters.
- `getTree` loads the whole document unless it is a committed read with an `id` and a `depth`;
  and it **unwraps transparent elements by default** (the config's `transparentElements`: their
  children are lifted into the parent) - pass `unwrap` explicitly when you walk or copy them.
- Prefer one pass that gathers what several steps need over re-reading the same records.

## Hooks: what fires when (core)

| Action             | Hooks, in order                                                                                                                                       |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tx.addChild`      | afterStandardizedRecord → afterCreated                                                                                                                |
| `tx.deepClone`     | per node: beforeClone → afterStandardizedRecord → afterCreated                                                                                        |
| `tx.update`        | afterStandardizedRecord → afterUpdated (not fired for a no-op update)                                                                                 |
| `tx.delete`        | beforeDelete (subtree still readable) → cascade → parent update staged → afterDelete                                                                  |
| end of transaction | your callback → beforeCommit → commit                                                                                                                 |
| import             | beforeImport(xml) → per record, at its closing tag (children before parent): afterStandardizedRecord → beforeImportRecord → store write → afterImport |

Consequences to remember:

- Operations a hook returns are staged raw: no standardisation, no fixed/xsi guards, no further
  hooks. A hook that deletes must also return the parent's `updated` op.
- Import hooks never read the store or call a query: collect in `beforeImportRecord`, resolve in
  `afterImport` from what was collected. Import writes are not undoable.
- `afterStandardizedRecord` runs on create, update, import and init: it must be idempotent.

## Adding your own extension (app side)

Same shape as the dialecte's own extensions, passed at project creation:

```ts
// my-feature/query/find-orphan-parts.ts - one function per file, types in find-orphan-parts.types.ts, test next to it
import type * as Core from '@dialecte/core'
import type { Config } from '@acme/widget/v1'   // the package's Config type (check its exports)

export async function findOrphanParts(query: Core.Query<Config>, params: FindOrphanPartsParams) { ... }

// my-feature/index.ts
export const myFeature = { query: { findOrphanParts }, transaction: { ... } }

// app
const project = createWidgetProject({ extensions: { myFeature } })
doc.query.myFeature.findOrphanParts({ assembly })   // first param is bound away
```

- First parameter is the query (or transaction), typed `Core.Query<Config>` /
  `Core.Transaction<Config>`, never the hydrated `<Name>.Query` (that type is built from the
  extensions: a cycle). Remaining parameters go in ONE object.
- To call a sibling method, import it and pass your own `query` / `tx`.
- Pick a namespace key of your own. A custom module whose key equals a module key the dialecte
  already uses (`inventory` in `@acme/widget`) merges into it, and only a same-named method there throws `EXTENSION_METHOD_COLLISION`. Nothing
  stops a top-level name from shadowing a core member: never name a module like a core method.
- Tests call the function directly with `source.query` / `tx`, not through the bound method.

## Testing

Each dialecte package exports table-driven runners from its `/test` entry
(`<package>/<version>/test` → `run<Name>TestCases`; core's own: `@dialecte/core/test`). Details
and the case format: [references/testing.md](references/testing.md). Short version: one table per
behaviour, inline XML fixtures with `dev:db-id` ids that say intent, `.withExport` asserts the
resulting XML with XPath, `.withoutExport` asserts inside `act`, `.generic` for pure functions.
Red first, one case at a time. No test names its store: the runner chooses it (in Node on the
in-memory store under a node vitest project whose setup file calls `useTestStorage`, core 0.8+).
Assertions take XML text; on a big file, check record expectations (tag, attributes, parent,
count) with the query API instead of XPath on the whole export.

## Check a behaviour by running it

When the question is what a call does to a document - which elements a verb writes, whether a write
is refused and with which error, what a hook adds - run it in Node instead of reasoning from the
source. `npx @dialecte/cli run` (a cli that lists `run` in its `--help`, on core 0.8) runs a script
against an in-memory project of the installed dialecte; ids are seeded, so the same script, input and
`--seed` give the same outcome.

1. **Expectations first**, in a JSON file: `[{ "tag": "Part", "under": { "tag": "Assembly" }, "count": 2 }]` -
   `where` for attribute values, `count: 0` for none, no `count` for at least one. They say what the
   user wants, which a valid document does not prove.
2. **The script** is a module whose default export receives `{ project, doc, documentId, dialecte, helpers, utils }`.
   Use the dialecte's verbs, not hand-built `addChild` chains; ask the user for values that are open.
3. **Run it**: `npx @dialecte/cli run script.ts --in fixture.xml --expect expected.json`. `--prepare` stages
   the first transaction and commits nothing (its operations and what its callback returned are
   printed); `--json` answers the outcome as data; `--out result.xml` writes the document;
   `--package <name>` names the dialecte when the project has none or several.
4. **Read the outcome**, not a guess: `failed: <code> <key> at <path>` for a thrown error, then
   `npx @dialecte/cli explain <code>` for when it is raised and the usual fix; each unmet expectation
   with the count found; the operations per tag. Exit 1 means failed or unmet.
5. Expectations red → script → green; show the user the prepared operations before anything is
   committed for real.

## Before you hand over

- Did you walk the reuse ladder and name what you reused?
- Does a hook already do any write you added by hand?
- Any query inside a loop over elements? Any `findAncestors` that could be a parent step?
- Any hand-written list that the definition or a registry already holds?
- Every Dialecte method you call confirmed in the installed version?

## Retro gate - before you hand over

List in your hand-over every place where this skill was wrong, missing or misleading for the task,
and every correction the user made that a skill should have prevented. Then:

- **Inside a dialecte repository**: draft each skill edit as before/after and show it to the user; an
  approved edit goes in the same change (skills ship with the package that owns the code), through
  skill-creator - the eval case first, failing on the current text, as `dialecte-lot` describes - then
  `npm run skills:generate` and `npm run skills:check` (see `dialecte-contributing`).
- **In an app**: draft an issue for the package that ships the skill - the statement that was wrong
  or missing, the evidence (file, behaviour), the wording you propose - and show it to the user.
  Post it only with their approval.
- Nothing to report: write "skill retro: nothing".
