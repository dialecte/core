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
- **A confirmation** (a name, a type, a cardinality the code already follows): one reader, with line references.
- **A decision that changes what the engine does or accepts** gets the cross-check, once per decision:
  1. Two or three independent readers on the `standard` tier (at least one on another model or vendor when
     one is available): the same question, no shared notes, a `file:line` for every claim.
  2. One reader takes the whole relevant part, the others split it by section, so coverage does not rest on
     one model's retrieval.
  3. An adjudicator on the `strong` tier compares the answers: an agreed claim with matching lines passes; a
     disagreement, or a claim without a line, becomes a question for the user or the domain expert. Runs of
     one model share its biases, so agreement is evidence, not proof.
  4. The result (question, claims, lines, verdict) goes in the plan's research folder, next to the plan: later
     lots reuse it instead of reading the standard again.

The tiers are in [model-tiers.md](model-tiers.md).

## What the station records

The hand-over card carries a `standard` line (`@dialecte/cli` 0.3.0). The cli learns where the text is from
`DIALECTE_STANDARD` (a file or a folder, from the environment only: never committed, never shipped), and the
station that read it records its word in the hand-over folder:

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
