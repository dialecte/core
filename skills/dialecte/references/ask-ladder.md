<!-- dialecte-skills workspace -->

# A question of your own: the ask ladder before a person

When you are about to ask the user something about the dialecte - may this element hold that child, is this
attribute required, what does this code mean, which method does this, what does the standard say about it - or
to decide it yourself from a hunch, ask the cli first: `npx @dialecte/cli ask "<question>"` (a cli that lists
`ask` in its `--help`). A person's time goes to what the installed files and the standard cannot answer, and a
guess is worse than either: it looks like an answer. The ask stops at the first rung that answers:

0. **a fact** recorded for the same question before (by an earlier ask, a reader verdict or a person:
   `npx @dialecte/cli facts list --about <Tag>`);
1. **the definition**, for a structural question (children, parents, required, values, default, fixed, type,
   variants, documentation); `--about [<Parent>/]<Tag>[@<attr>]` names the element when the words are ambiguous,
   the parent when a tag is declared several ways;
2. **the catalogues and the api index**: `--code <code>` (what `explain` knows), `--method <path>` (`api find`);
3. **the standard's documents** (the folder `DIALECTE_STANDARD` points to; never committed): slices of the text,
   handed to readers;
4. **readers** of those slices, whose cites the cli checks line by line;
5. at high effort, an **adjudicator** when the readers do not agree;
6. **a person**, last, with what every rung found.

Then follow the `next:` line it prints, by exit code:

- **0 answered**: use the answer; it is recorded as a fact with its source, so the next agent gets it at rung 0.
- **3 readers next**: `npx @dialecte/cli ask pack <ask-id>` writes one brief per reader
  (`rounds/round-<r>/reader-<A|B|C>.md` in the ask folder). Give each brief to its own independent sub-agent on
  the `standard` tier (the `dialecte-lot` skill, references/model-tiers.md), no shared notes; each writes the one JSON report its brief asks for, every claim cited by
  line. Then `npx @dialecte/cli ask verdict <ask-id> <report.json>...` (`--missing <letter>` for a reader that
  wrote nothing): it checks each cite against the lines that reader was given and records an agreed answer.
  Exit 3 again: another round (`ask pack` again) or, at high effort, the adjudicator - `ask pack` writes its
  brief, a `strong`-tier sub-agent answers it, `ask verdict <ask-id> <report.json> --adjudicator`. Never edit a
  report to make it pass: a refused cite is a reader's miss.
- **1 a person next**: now ask the user, with the ask id and what the ladder found. Record the reply with
  `npx @dialecte/cli ask answer <ask-id> "<answer>" --by <who>` (in a lot that raised the question:
  `npx @dialecte/cli lot answer <lot> <question> "<answer>" --by <who>`), so nobody asks it twice.
- **2 refused**: fix the call - an unknown tag names the closest one; several dialectes need `--package`.

- **No documents configured**: the ask goes to outside readers (`ask pack <ask-id> --outside`, `--web` when your
  host lets them search). Their answer is recorded `unchecked`, never as the standard's: say so when you use it,
  and let a person confirm it (`ask answer`). Offer the user to set `DIALECTE_STANDARD`.
- **A choice the definition does not make** (what the standard adds beyond the XSD): `--decision`. The
  definition becomes the boundary and the answer comes from the prose inside it; a `! conflict:` line means the
  standard and the XSD disagree - the XSD wins, tell the user.
- In a lot, `--lot <id|folder>` (implied inside a lot's worktree) keeps the ask with the lot. An ask
  that reaches the documents or the outside readers writes the lot's `standard` note itself (the hand-over card
  shows it; in a CI-first lot, `lot review`); a lot whose asks all stopped at rungs 0-2 records nothing, so it
  records its word with `lot standard` as the `dialecte-lot` skill's references/standard-check.md says.
- The documents stay private: a slice, a quote or a reader's report never goes into committed text or a pull
  request. State the behaviour in your own words.
