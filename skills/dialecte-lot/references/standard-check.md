<!-- dialecte-skills workspace -->

# The standard check

For code that implements a standard - a dialecte, or an app's own Dialecte code that follows one: the standard is
the truth its rules come from, and a long text read once by one model is not a reliable source.

- **Markdown first.** Read the standard as markdown, citing `file:line`; never the PDF. A document not yet in
  markdown is converted first: markitdown for PDF, DOCX or PPTX; docling or pymupdf4llm when its tables come
  out broken.
- **The converted text stays private**: kept next to the plans, outside every package repository; never
  committed, never quoted or cited in committed text (code, doc, CHANGELOG, skill) or on GitHub. Committed text
  states the behaviour.
- **Ask the cli first** (a cli that lists `ask` in its `--help`): `npx dialecte ask "<question>" --lot <lot>`
  climbs the ladder - a fact recorded before, the definition, the catalogues and api index, then the slices of
  the documents for readers - and stops at the first rung that answers. The question is answered once, recorded
  as a fact with its sources, and every later lot gets it at rung 0 instead of reading the text again. The rungs
  and exit codes are in the `dialecte` skill's references/ask-ladder.md; the documents are the markdown folder
  `DIALECTE_STANDARD` points to, so a PDF is converted before the ask can read it.
- **A confirmation** (a name, a type, a cardinality the code already follows): the ask; a structural question
  answers at rung 1 from the definition. Without the cli's ask: one reader, with line references.
- **A decision that changes what the engine does or accepts** gets the cross-check, once per decision:
  `npx dialecte ask "<question>" --decision --lot <lot>` (`--decision`: the definition is the boundary, the
  answer comes from the prose inside it; the lot's effort sets how many readers and rounds).
  1. **Readers**: `npx dialecte ask pack <ask-id>` writes one brief per reader. Reader A reads the relevant part as a
     whole (the slices by rank); B splits it by angle family and C (high) as B without the top slice, so coverage
     does not rest on one retrieval. Each brief goes to its own `standard-reader` station on the `standard` tier (at least one
     on another model or vendor when one is available), no shared notes; each writes the JSON report its brief
     asks for, every claim cited by line.
  2. **Verdict**: `npx dialecte ask verdict <ask-id> <report.json>...` checks every cite against the lines that
     reader was given and the polarity of each claim, then applies agreement (same verdict, same value, a shared
     line or clause). Exit 3: another round (`ask pack` again), or at high the adjudicator: `ask pack` writes its
     brief, a `strong`-tier station answers, `ask verdict <ask-id> <report.json> --adjudicator`. A report is never
     edited to pass: a refused cite is that reader's miss. Runs of one model share its biases, so agreement is
     evidence, not proof.
  3. **The person**: exit 1 - no agreement, nothing in the text, the adjudicator refused - is a question for the
     user or the domain expert, never a majority or a guess. In a store lot the ask raises it on the lot and
     `npx dialecte lot answer <lot> <question> "<answer>" --by <who>` records the reply; elsewhere
     `npx dialecte ask answer <ask-id> "<answer>" --by <who>`.
  4. **The result goes next to the plan**: a note in the plan's research folder with the question, the agreed
     claims with their `file:line`, the verdict, and the ask and fact ids, so a later lot reads it there instead
     of reading the standard again. The cli keeps its own copies too: the fact in the facts ledger
     (`npx dialecte facts show <id>`, which a later ask reuses at rung 0) and the ask folder under the lot
     folder's `asks/` (slices, reports, `verdict.json`).
- **No documents configured**: the ask goes to outside readers (`ask pack <ask-id> --outside`, `--web` when the
  host allows it); their answer is recorded `unchecked` and never stands as the standard's. Propose to the user to
  configure one; a person confirms the answer with `ask answer`.
- **With a cli older than the ask**, the same cross-check by hand: two or three independent `standard`-tier readers
  on the same question, one on the whole relevant part and the others split by section, a `file:line` for every
  claim; a `strong`-tier adjudicator compares them, an agreed claim with matching lines passes, a disagreement or
  a claim without a line goes to the user or the domain expert; the result (question, claims, lines, verdict) in
  the plan's research folder.

The tiers are in [model-tiers.md](model-tiers.md).

## What the station records

The hand-over card carries a `standard` line (`@dialecte/cli` 0.3.0). The cli learns where the text is from
`DIALECTE_STANDARD` (a file or a folder, from the environment only: never committed, never shipped). An ask run
with `--lot` (or inside the lot's worktree) that reaches the documents or the outside readers writes the lot's
note itself: `consulted`, naming each ask and its state, or `outside` (a warning on the card - in a CI-first lot, `lot review` - and a failure at effort
high until a person confirmed every outside answer). A lot with no such ask records its word by hand:

- consulted: `npx dialecte lot standard <folder> consulted <note>` - the note says what was checked; the
  `file:line` refs stay in the plan's research folder or the findings ledger, never in committed text. The card
  shows `✓ standard consulted`.
- none configured: propose to the user to configure one, then `npx dialecte lot standard <folder> not-consulted
  <reason>`. The card shows `! standard not consulted`, which never blocks.
- a standard configured and nothing recorded fails the card (`✗ standard`); with one configured, only `consulted`
  passes, `not-consulted` fails it too.

Every hand-over has the line, so every lot records one. A lot that changes nothing a standard rules (tooling,
wording, an app's UI-facing service): with none configured, `not-consulted` with that reason; with one
configured, the station still searches the text for what the lot touches and records `consulted` with what it
found ("nothing in the text rules <what the lot changes>"), never a `consulted` it did not do.
