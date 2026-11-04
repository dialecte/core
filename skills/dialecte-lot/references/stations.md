<!-- dialecte-skills workspace -->

# Station agents

The stations of a lot that run as their own agent, defined once and for every host. A section is what the agent
is: its tier ([model-tiers.md](model-tiers.md)), its access, its role. The brief ([briefs.md](briefs.md)) adds
the lot: which step, which files, which worktree.

**Access** says what the agent may do, whatever the host calls it:

- `read`: reads files; runs nothing, edits nothing.
- `review`: reads files and runs commands (tests, `dialecte tdd status`, a build); edits no file.
- `edit`: reads, edits files in its worktree, runs commands.

**Spawning one.** A host with an adapter has the agent ready: its tier and access are set by the adapter's file,
so the spawn names the station and hands the brief. Claude Code: `.claude/agents/dialecte-<station>.md`,
written by `npx @dialecte/cli skills sync --contributing`. A host without one spawns a general sub-agent:
the model of the station's tier (`npx @dialecte/cli models`), the narrowest tool or sandbox setting the host has
that still allows the access (a read-only sandbox for `read` and `review`, workspace edits for `edit`; a host
that cannot restrict says the access in the prompt), and a prompt holding this station's section, then the
brief. The lot stations (all but `eval-runner` and `grader`) load `dialecte-lot`, `dialecte-contributing` and
`dialecte` first: they are the source of truth, the section only sets the envelope. The eval runner and the grader
load only what their brief names: a skill-eval run compares texts of a skill, so the runner reads the text its
configuration names and the grader none, blind to which text produced a run.

**Never, every station**: commit, stage (`git add`), push, merge, `git stash`, `git reset`, `git restore`,
`git checkout --`, `rm`; nothing outside the worktree the brief names. The brief is the agent's whole context.

### test-writer

- Tier: standard
- Access: edit

Station 1a. Writes the tests of one brief step from the spec, never the production code. It may add stubs
whose body throws `not implemented: <name>` so the tests compile, called inside `expect(...)`. It runs
`dialecte tdd red` until every case is red on an assertion, and answers with its output.

### test-reviewer

- Tier: strong
- Access: review

Station 1b. Reads the tests of the step against the brief, before any production code. It modifies nothing
(`dialecte tdd status` is the one command to run). It answers per test: the behaviour it pins, a plausible
wrong implementation it lets through, a verdict.

### implementer

- Tier: standard
- Access: edit

Station 1c on a mechanical or fully specified lot, step mode. The tests are written and red: it changes
production code only until `dialecte tdd green` passes; a test it finds wrong goes back to the test station
with the reason. It runs the fast gate and answers with the implement report shape of the skill.

### implementer-strong

- Tier: strong
- Access: edit

Station 1c on a design-heavy lot: the same job and report as `implementer`.

### reviewer

- Tier: strong
- Access: review

Station 3, a different agent from the implementer. It modifies nothing: it reads the diff and runs the tests.
It answers with the review report shape of the skill (both passes, a verdict).

### fixer

- Tier: standard
- Access: edit

Station 4 (fix mode) on wording and naming findings. For each finding it answers fixed, disagreed (one line
why) or needs the user, with the blast-radius line of each fix; it never drops one.

### eval-runner

- Tier: standard
- Access: edit

Runs one skill-eval case of a Dialecte skill (a skill text change goes through skill-creator evals), with or
without the skill as its brief says, and writes only the outputs the case names. The strong tier runs the
second configuration.

### grader

- Tier: strong
- Access: read

Grades the output of a skill-eval run against the grader files its brief names, blind to which text produced
it. It reads, never runs or changes anything: pass or fail per grader, with the line that shows it.

### standard-reader

- Tier: standard
- Access: read

Reads the standard for one question ("Reading the standard" of `dialecte-contributing`): the standard markdown
only, answering with line references, never relying on what another agent concluded.

### searcher

- Tier: fast
- Access: read

Locates code, files or documentation for the question its brief asks, in the Dialecte repositories it names:
absolute paths and line numbers, nothing speculative.
