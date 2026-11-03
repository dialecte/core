<!-- dialecte-skills workspace -->

# Verification traps in dialecte repos

Each of these produced a confident, wrong "green". Before reporting a gate as passed, check that it
ran what you think it ran.

## Type checking

- `tsc -p tsconfig.json --noEmit` checks **nothing**: `tsconfig.json` is a solution file
  (`files: []` + references). Use `npm run check`, which runs `tsconfig.build.json` (sources) and
  `tsconfig.vitest.json` (tests).
- The build config excludes `*.test.ts`: a type error in a test passes `npm run build`. Only
  `npm run check` (or `tsc -p tsconfig.vitest.json --noEmit`) sees it.
- `npm run build` runs the type-check in parallel and emits declarations through vite-plugin-dts,
  which catches union-assignability errors the editor misses (its own `tsc -p tsconfig.json` step
  is the solution no-op). Run it; editor squiggles are not a gate.
- `ReturnType<typeof genericFactory>` instantiates type parameters with their constraint, not the
  default: an extension map widens to an index signature. Type from a call (`const p = factory()`).

## Tests

- vitest pre-bundles dependencies into `node_modules/.vite`. After changing what a package
  resolves for `@dialecte/core` (link, copied `dist/`), delete `node_modules/.vite` and
  `node_modules/.vite-temp`, or tests keep running the old core while `tsc` sees the new one.
- Shell wrappers that compact output can report `PASS (0) FAIL (0)` or "ok" for a run that failed
  or ran nothing. Run verdict-bearing commands unfiltered and read the real counts.
- A case that is green on its first run may be green by accident (an XPath matching another
  element, last-wins index, id order). Break the code on purpose once.
- Benches running in the browser print nothing unless run with `--silent=false`.
- A test owns its temporary folder: `mkdtempSync(join(tmpdir(), '<prefix>-'))`, removed when it ends. The
  system's temporary folder itself, scanned or used as a project root, holds what every other test and
  process left there: green alone, red under load (`dialecte rules` reports it).
- A time bound carries slack: several times what the call takes on an idle machine, measured around the
  call under test only (`performance.now()` before and after it). A test's or a file's duration counts a
  worker's or a browser's start and the machine's load, so a tight bound fails for reasons the code
  does not have.
- A test that reads the disk (a scan of every source file), spawns a process or measures time carries an
  explicit bound with wide slack, never the runner's default timeout: its cost grows with the repository and
  slows down many times over when another suite or a commit hook loads the machine. Name the bound in a
  constants file with why it is that wide (core: `SOURCE_SCAN_TIMEOUT_MS`, 30 s, in
  `src/test/test-timing.constants.ts`). The test review and the review check that every such test has a bound
  that is explicit, named and several times what the test takes on a quiet machine: a scan with vitest's
  default 5 s passed every rehearsal and refused a real merge commit on a loaded machine.
- A suite that spawns git (a scratch repository, a worktree) runs no git process with the `GIT_*` variables of
  the process running it. git exports variables such as `GIT_INDEX_FILE` to the hooks of a commit, and `GIT_DIR`
  too when the commit runs in a worktree: under the commit hook, a git process inheriting them acts on the outer
  repository - its config, its index, a commit - instead of its scratch one. Green in a terminal, destructive at
  commit. Clear them from the suite's own environment before any test - a vitest setup file deleting every `GIT_`
  key of `process.env` - since the code under test spawns git with `process.env` too; a per-call `env` covers
  the test's own calls only. Read the package's vitest config before relying on such a file: only a file in the
  `setupFiles` of the project that runs the test runs (with `test.projects`, a root `setupFiles` reaches a
  project only through `extends: true`), and a package without one gets it, registered there, in the same step.
  Keep what git needs (`PATH`, an identity set on the call or in the scratch repository).

## Tooling

- Never run `pnpm` in an npm repo: it rewrites `node_modules` to the pnpm layout, replaces linked
  packages with published ones and creates a pnpm lockfile. Repair, only in the repo you broke and
  after checking no hand-over script is running there: delete the pnpm files,
  `rm -rf node_modules && npm ci`, redo any deliberate local link, clear `.vite`.
- Never run `prettier` in these repos: format with `oxfmt` (`npx oxfmt <paths>`,
  `npm run format:check`).
- A package's `npm run doc:build` may regenerate a committed data file (an element catalog, a
  generated docs page). If you did not mean to change it, restore it right after the doc build,
  before `check` and before any hand-over script exists - never while one is waiting. The
  package's own skill names such files.
- Before `@dialecte/cli` 0.2.0, `dialecte bench --help` is not a help flag: it runs the bench and
  writes `baseline.json`. From 0.2.0, `--help` on any command only prints the help.
- Type bench counts are only order-stable single-threaded (TypeScript 7 runs parallel checkers that
  each re-create types). Bench through the package's single-checker bench tsconfig.
- `dialecte-xmlfmt` reformats `/* xml */` template literals; it can mangle a nested template
  literal - check the diff.

## Tools with shared state

For a lot that builds tooling (the cli above all) rather than engine code. Each trap cost a lot several review rounds.

- **A store several runs share** (a ledger, a records file, a run store, a cache, a lock) planned as prose is wrong
  in ways only interleavings show: two runs finishing in either order, overlapping runs, a crash between two writes,
  a dead or reused owner. The plan writes it as a transition table (event, from, to, condition), its invariant
  ("an item leaves pending only by ...") and the list of interleavings; the test station writes one forced-order
  test per interleaving before any code. Liveness is the process id plus its start time read in UTC, never the id
  alone.
- **A fake runner proves the wiring, not the integration.** A lot that drives an external tool (StrykerJS, vitest,
  git, npm) records one real run on a known target with its expected numbers before the hand-over, in `SMOKE.md` in
  the hand-over folder.
- **That run happens in a scratch `git clone`** (its own `.git`), never a worktree of a real repository: worktrees
  share the git folder, so a store under it (`dialecte-mutation/`, the check records) takes the experiment's state
  and blocks the next real hand-over. State that landed in a real store anyway is cleared through the cli only.
- **A value a third-party tool produces or consumes** (a report field, a column, a config key) is pinned by a test
  that cites its source: a file and line of the tool, or a recorded real run. A shape from memory merged once one
  column off.

## Shell

- zsh does not word-split `$FILES`: `git diff -- $FILES` with a space-separated list addresses one
  non-existent path and hashes an empty diff. Use an array inside `bash`, and print `--stat` next to
  every hash or verdict so an empty one is visible.
- macOS ships bash 3.2: no `mapfile`, no associative arrays. Scripts handed to a human should
  re-exec themselves in bash and stay 3.2-compatible.
- Never `open(path, 'w')` and read the same file in one expression (truncation loses work).

## Docs and code drift you will meet

Docs can lag the code. When they disagree, the source wins, and fixing the doc is part of the
change if you touch that surface. Known kinds of drift: methods named in docs that no longer exist,
docs still showing an older project/hooks wiring, JSDoc describing an older lookup order, stale
npm scripts pointing at missing files, dead links in AGENTS.md.
