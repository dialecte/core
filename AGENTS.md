# Working on @dialecte/core

Every coding agent working in this repository reads this file. Notes that hold only for one machine (local
paths, where the standard's text lives, a person's working setup) go in `AGENTS.local.md` beside it, which git
ignores; read it when it exists.

## First commands

<!-- dialecte-skills:session-check -->

At the start of a session, run `npx --no-install @dialecte/cli doctor --brief`: nothing printed means the Dialecte skills are in sync; otherwise each line is a problem with its fix.

<!-- /dialecte-skills:session-check -->

When it says so, run `npx dialecte skills sync`.

## Skills to load

Load `dialecte` first, then `dialecte-contributing` to change this package; to run a lot, `dialecte-lot`.
`npx dialecte skills sync` installs them where your agent reads skills.

## Before writing code

List what already covers the concept: `dialecte api find`, `explain`, `schema`, `fixture`, `standard find` /
`show` (`npx dialecte --help` lists them), then the package skills, then a code search. Reuse what fits; a shared
read found wrong is fixed in place, never forked.

## Answers

Lead with the result; keep a reply short: no repetition, no filler, in whole sentences a person can read in one
pass.

## Code rules

1. Never `any`: use `AnyDialecteConfig`, `AnyRawRecord`, `AnyApiRecord`, or the dialecte's hydrated type.
2. Always narrow types.
3. Types in `*.types.ts`, constants in `*.constants.ts`; named functions; object parameters; no `await` inside
   an argument (`npx dialecte rules <files>` checks these).
4. Immutable operations: records are values, never mutated; return new values.
5. Files grouped by concern, not by technical layer.
6. Types compile away: no runtime cost for typing.
7. Explicit context: no hidden state.
8. Core has no domain knowledge: a rule of one dialecte belongs in that dialecte.
9. The standard is the text: a behaviour the standard names is checked against its text
   (`dialecte standard find` / `show`) before it is proposed; code, current behaviour and a chat sentence are
   pointers, never the source. Committed files never quote or cite it.

## Attribute reads

- A query or transaction at hand: `query.getAttribute(s)` / `tx.getAttribute(s)` (typed, sees staged writes).
- No query (an import pass, a pure composer): `readAttribute(s)` from `@dialecte/core/helpers`: same options and
  results, synchronous, the record as held. Never inside a transaction on a record held across a write.
- Absent or written empty: `{ defaults: 'none', fullObject: true }` gives `undefined` when absent.

## Functional rules

Immutable operations, pure functions in type utilities, explicit state (context), composable methods (chains),
no side effects.

## Definition of Done

Tests first, red before green, co-located with the code.

- Every step: `npx dialecte tdd red` then `npx dialecte tdd green` for its cases, the tests related to the
  touched files, `npm run check`, and `npx dialecte rules` on the touched files.
- Every behaviour: `npx dialecte gate --fast`.
- Every lot: `npx dialecte gate --full` once, before the hand-over (`npx dialecte gate --help` prints the
  configured steps).
- A change to the public API or a visible behaviour also updates the docs under `doc/`, adds a
  `## [Unreleased]` entry to `CHANGELOG.md`, and updates the skills under `skills/` that describe it
  (`npm run skills:generate`, then `npm run skills:check`), in the same change.

## Stations

In a lot, each station changes only what its role may change (the role rule in `dialecte-lot`): reviewers change
nothing; the test station changes tests, test data and stub production code; the implementer changes production
code in scope and the CHANGELOG; only the lot session deletes.

## Never

- Commit, stage, push, stash, `git reset` / `restore` / `checkout --`, switch branches, or edit under `.git`,
  unless the person asks.
- Write a real person's name or handle in a committed file, test values included (use `reviewer`, `person-a`).
- Name a tool that consumes the package, a coding-agent host or a model in a committed file.
- Put the standard's text, file names or clause numbers in a committed file.
- Edit a `*.generated.ts` file (regenerate it).
