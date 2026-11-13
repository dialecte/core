<!-- dialecte-skills workspace -->

# The skill-eval loop

A skill text change is code: when a lot changes what a skill tells agents to do (a new command to run, a rule),
it goes through the **skill-eval loop**. A skill change judged by hand, or by the agent that wrote it, looks green
on one run and its own reading; the loop is what shows the change moves behaviour.

1. **The case first**: an eval case under the skill's `evals/` (its prompt and graders) that describes the
   behaviour the new text must produce. The text before the change fails it.
2. **Runs with and without the change**: the changed text and the text before it (`git show <base>:skills/...`
   into the eval workspace), on the standard and the strong tier, every run with the same tools.
3. **Repeats**: several runs per configuration (at least two).
4. **A blind, separate grader**: another agent grades each run against the case's graders and is not told which
   text produced it. The agent that wrote the change never grades its own runs.
5. **A benchmark**: the pass rate of each configuration, the changed text against the current skill.
6. **Verdicts in the lot folder**: the runs, the grades and the benchmark, with their paths in the report.

Use the host's skill-evaluation tool where it has one ([hosts.md](hosts.md)); otherwise run the loop by hand,
with the `eval-runner` and `grader` stations ([stations.md](stations.md)). Then `skills:generate` and
`skills:check`.
