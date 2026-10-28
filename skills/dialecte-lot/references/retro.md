<!-- dialecte-skills workspace -->

# Retro

The loop that makes the skills better instead of just used. Run it at the end of every lot (short) and of
every larger change (complete). Write the moment a mistake is caught, not from memory at the end.

## 1. Facts first

- **Loops**: review rounds per lot; what each round found.
- **Late findings**: what review (or the user) caught that an earlier station should have - and which one.
- **False greens**: a gate that said ok while something was wrong (wrong tsconfig, filtered output, a test
  green by accident). These are the most expensive findings.
- **Corrections by the user**: verbatim, with what they corrected.
- **Plan drift**: deviations, and whether they were a plan flaw or a discovery.
- **Token ledger**: sub-agent tokens per station, from the completion notices (implementer, each review and
  fix round, skill-eval runs, graders), the tier each ran on, and every escalation with its reason. No fixed
  budget: the ledger is what shows where a lot's tokens went, and what later lots compare against.

The **hand-over message** carries the ledger as one usage line for the user, for example "this lot cost
~1.1M tokens: implementer 450k, review 320k, fix 90k, evals 240k". A station far above the others in that line is a
retro fact too: why it ran long, and whether its tier or its brief was wrong.

## 2. From facts to improvements

For each pattern, name the responsible skill (or script) and the smallest change that would have
prevented it:

| Category  | Means                                                  | Fix goes to                                                                |
| --------- | ------------------------------------------------------ | -------------------------------------------------------------------------- |
| skill     | an instruction was missing or wrong                    | a before/after edit of that skill, with an eval case that fails without it |
| tooling   | a script or a check would enforce it better than prose | a cli command, a gate, a guard in the hand-over script                     |
| knowledge | a domain or tool fact nobody had                       | the package docs, or the skill reference that owns the topic               |
| one-off   | unusual, no change                                     | the retro entry only                                                       |

No "be more careful" edits: if you cannot point to a missing instruction, it is not a skill improvement.

## 3. Entry shape

```
### <id> <one-line title>
- What happened: facts, who caught it, the cost.
- Root cause: why it slipped through.
- Category: skill | tooling | knowledge | one-off
- Fix: the smallest change that prevents it (which skill / script / rule).
- Status: open | applied (<where>) | dropped (<why>)
```

Keep the entries where the team keeps its retro log (a folder outside the repositories, so plan tags and
references are allowed there), one file per lot or session, with an index. Skill edits are drafted
before/after, applied on the user's approval, one per finding.
