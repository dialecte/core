<!-- dialecte-skills workspace -->

# Model tiers

A brief names a **tier**, never a model: the same skill serves every coding agent, whatever its vendor.
Which model a tier is for your project comes from `npx @dialecte/cli models` (the map for the vendor the
project uses, `--json` for a script); read it there instead of guessing or writing a name in a brief.

## The tiers

| Tier       | For                                                                                                                                                                        |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `fast`     | search and locate, graders with a schema, log and diff summaries, format and shape checks, "does file X say Y"                                                             |
| `standard` | the test station, an implementer on a mechanical or fully specified lot, fix mode on wording or naming findings, skill-eval runs, independent readers of a standard        |
| `strong`   | the orchestrator, the test review, an implementer on a design-heavy lot, the review (one agent, both passes), adjudicating a disagreement, the retro                       |
| `frontier` | rare: a plan challenge, a decision across repositories, a lot still stuck at the review cap, once the user decided to go on                                                |
| no agent   | gates, counts, hashes, generated blocks, scaffolds, hand-over scripts: a `dialecte` command run by the station that needs it, never a sub-agent spawned to read its output |

## Station to tier

"Usual" is what the station's agent or command took on the runs measured so far; "deadline" (about 2-3x
usual) is when the orchestrator looks at a background run (Rules, below). A command timed on earlier runs
gets 3x that duration instead.

| Station                                   | Tier                                                                            | Usual                        | Deadline                                          |
| ----------------------------------------- | ------------------------------------------------------------------------------- | ---------------------------- | ------------------------------------------------- |
| 0 Orchestrate                             | strong                                                                          | -                            | -                                                 |
| 1a Test (test station)                    | standard                                                                        | 10 min                       | 20 min                                            |
| 1b Test review                            | strong: the tests against the spec, before any code                             | 5 min                        | 15 min                                            |
| 1c Implement                              | standard for a mechanical or fully specified lot; strong for a design-heavy one | 30 min / 45 min              | 60 min / 90 min                                   |
| 2 Fast gate                               | no agent (`dialecte gate --fast`, `dialecte rules`)                             | 5 min                        | 10 min                                            |
| 3 Review                                  | strong: one reviewer runs pass 1 (correctness) and pass 2 (fit)                 | 10 min                       | 20 min                                            |
| 4 Fix                                     | standard for wording or naming findings; otherwise the implementer's tier       | 15 min                       | 30 min                                            |
| 5 Full gate                               | no agent (`dialecte gate --full`)                                               | -                            | 3x a duration measured on earlier runs            |
| 6 Hand over                               | no agent (`dialecte handover`; `handover run --rehearse` runs the commit hook)  | 20 min, rehearsal with hooks | 45 min, or 3x a duration measured on earlier runs |
| 7 Retro                                   | strong                                                                          | 15 min                       | 30 min                                            |
| Skill-eval runs / their graders           | standard (the tier most readers of a skill run on) / fast, with a schema        | 1 min / 1 min                | 5 min / 5 min                                     |
| Reading a standard: readers / adjudicator | standard / strong (`dialecte-contributing`, "Reading the standard")             | -                            | 30 min / 30 min                                   |

## Rules

- **Per station**, not per lot: one lot spawns agents on several tiers.
- **Escalate, do not start high.** A station starts at its tier; after a failed round it may go one tier up,
  and the report says so. The next lot starts at the table's tier again.
- **Never down-tier a correctness review** to save tokens: pass 1 stays on strong.
- **Effort is a second knob**: low for fast-tier jobs, the default elsewhere, high only for the review and
  adjudication.
- **The brief names the tier** (`Tier:` in [briefs.md](briefs.md)); the orchestrator spawns accordingly.
- **Every background run has a deadline**: the station's deadline above, or three times a duration measured
  on earlier runs of the same command (a hook, a gate, a bench). The deadline is when you look, never a
  reason to kill: a run is stopped on what you see (no new output and no CPU time gained by its process tree),
  never on the clock. See "Deadlines" in the skill.
