<!-- dialecte-skills workspace -->

# Model tiers

A brief names a **tier**, never a model: the same skill serves every coding agent, whatever its vendor.
Which model a tier is for your project comes from `npx @dialecte/cli models` (the map for the vendor the
project uses, `--json` for a script); read it there instead of guessing or writing a name in a brief.

## The tiers

| Tier       | For                                                                                                                                                                        |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `fast`     | search and locate, graders with a schema, log and diff summaries, format and shape checks, "does file X say Y"                                                             |
| `standard` | an implementer on a mechanical or fully specified lot, fix mode on wording or naming findings, skill-eval runs, independent readers of a standard                          |
| `strong`   | the orchestrator, an implementer on a design-heavy lot, the review (one agent, both passes), adjudicating a disagreement, the retro                                        |
| `frontier` | rare: a plan challenge, a decision across repositories, a lot still stuck at the review cap, once the user decided to go on                                                |
| no agent   | gates, counts, hashes, generated blocks, scaffolds, hand-over scripts: a `dialecte` command run by the station that needs it, never a sub-agent spawned to read its output |

## Station to tier

| Station                                   | Tier                                                                            |
| ----------------------------------------- | ------------------------------------------------------------------------------- |
| 0 Orchestrate                             | strong                                                                          |
| 1 Implement                               | standard for a mechanical or fully specified lot; strong for a design-heavy one |
| 2 Fast gate                               | no agent (`dialecte gate --fast`, `dialecte rules`)                             |
| 3 Review                                  | strong: one reviewer runs pass 1 (correctness) and pass 2 (fit)                 |
| 4 Fix                                     | standard for wording or naming findings; otherwise the implementer's tier       |
| 5 Full gate                               | no agent (`dialecte gate --full`)                                               |
| 6 Hand over                               | no agent (`dialecte handover`)                                                  |
| 7 Retro                                   | strong                                                                          |
| Skill-eval runs / their graders           | standard (the tier most readers of a skill run on) / fast, with a schema        |
| Reading a standard: readers / adjudicator | standard / strong (`dialecte-contributing`, "Reading the standard")             |

## Rules

- **Per station**, not per lot: one lot spawns agents on several tiers.
- **Escalate, do not start high.** A station starts at its tier; after a failed round it may go one tier up,
  and the report says so. The next lot starts at the table's tier again.
- **Never down-tier a correctness review** to save tokens: pass 1 stays on strong.
- **Effort is a second knob**: low for fast-tier jobs, the default elsewhere, high only for the review and
  adjudication.
- **The brief names the tier** (`Tier:` in [briefs.md](briefs.md)); the orchestrator spawns accordingly.
