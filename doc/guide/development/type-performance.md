---
description: How to use the dialecte type-performance CLI (coverage, bench, narrowing, audit) — what each command is for, what the two CI gates catch, and how to read the bench and the readability audit. Practical guide for day-to-day development.
---

# Type Performance & CI Gates

Dialecte ships a dev-only CLI — **`dialecte`** (from `@dialecte/cli`) — that keeps a dialect's **types** fast and its **IntelliSense** correct. It never reaches production: it's a `devDependency` that reads your schema and runs your project's own `tsc`.

You rarely run it by hand. Two **CI gates** run it on every pull request and merge-queue run, and this page explains what they do and what to do when one turns red.

## TL;DR

- **Build is green** → nothing to do.
- **`type-bench` is red** → your change made the type system **> 5% more expensive** than the base it goes onto (slower editor, slower builds). Either simplify the types, or — if the extra cost is intentional — explain it: add a line `- Type cost: <why>` to your changelog fragment (or `Type cost: <why>` to your no-entry note).
- **`type-narrowing` is red** → your change **broke narrowing / IntelliSense** (e.g. a return widened to `any`, the element union widened to `string`, `Ref` stopped requiring `id`). This is almost always a real bug — fix the types.

::: tip Two reds mean different things
`type-narrowing` red = **a guarantee broke** → fix it. `type-bench` red = **cost moved** → decide: optimize, or explain it on purpose.
:::

## What the commands are for

Everything is driven by your schema — no lists to maintain. Discovery is automatic: versions from `src/<version>/definition/`, namespace from the (capitalized) package name.

| Command                    | What it does                                                                                                                                                                                                                                    | Who runs it                                 |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| `dialecte coverage`        | Generates type-probe files from the schema — every element/edge/attribute **and** the full public method surface (incl. extension groups like `history`, `reference`, `dataModel`) — into `benchmarks/types/<version>/generated/` (git-ignored) | automatically, before `bench`/`narrowing`   |
| `dialecte bench [--check]` | Measures the change's type-instantiation cost against the base it goes onto, fresh (`tsc --extendedDiagnostics`); stores nothing. `--check` fails on a **> 5%** regression the change does not explain                                          | you (`npm run type-bench`) / CI (`--check`) |
| `dialecte narrowing`       | Generates exhaustive narrowing assertions from the schema, then type-checks them (and the full surface). Fails if a narrowing guarantee broke or the surface no longer compiles                                                                 | CI                                          |
| `dialecte audit`           | Renders the public type surface and flags noisy hovers by cause (C1–C6) → `readability-audit.md`. **Informational, not a gate**                                                                                                                 | you, when reviewing hover readability       |

The matching npm scripts (in `@dialecte/core` and each dialect):

```bash
npm run type-bench        # regenerate probes + measure the change against its base
npm run type-bench:check  # CI: fail on an unexplained > 5% instantiation regression
npm run type-narrowing    # CI: assert narrowing still holds
npm run type-audit        # write readability-audit.md (dialects only)
```

## The two CI gates — what protects you

`_type-perf.yml` runs `type-bench:check` then `type-narrowing` on every pull request and merge-queue run; it checks out the base the change goes onto and hands it to the bench (`DIALECTE_CHANGE_BASE`: the queue's base, else the pull request's first parent). Combined with your normal `tsc` build, here's what each change triggers:

| You change…                                                                                   | `tsc` build |         `type-narrowing`          |    `type-bench`    |
| --------------------------------------------------------------------------------------------- | :---------: | :-------------------------------: | :----------------: |
| Add a method / refactor, cost ≈ same                                                          |     ✅      |                ✅                 |         ✅         |
| Silently break narrowing (return → `any`, drop `Ref` `id`, wrong child edge) — still compiles |     ✅      |          ❌ **catches**           |         —          |
| Break compilation (bad signature)                                                             |     ❌      |                ❌                 |         —          |
| Correct change that blows up type cost > 5%                                                   |     ✅      |                ✅                 |   ❌ **catches**   |
| Intentional schema change (add element, flip a singleton)                                     |     ✅      | ✅ _(assertions auto-regenerate)_ | maybe ❌ → explain |

## How to read the bench

Nothing is stored: each run measures the base and the head fresh, with the head's compiler on one checker, and compares them scenario by scenario. Only the **deterministic** metric is gated — timing and memory vary run-to-run, so the gate compares **`Instantiations`** only. Each row reads within 5% of its base, a gain, over, new or gone.

The **scenarios** each isolate a cost:

| Scenario                           | What it measures                                                                       |
| ---------------------------------- | -------------------------------------------------------------------------------------- |
| `whole-program (check)` / `(emit)` | type-checking / emitting the whole package                                             |
| `baseline (import)`                | a bare import — the floor the others are compared against                              |
| `coverage: surface`                | every per-element generic (`Ref`, `TrackedRecord`, `ChildrenOf`, …) over every element |
| `coverage: calls`                  | every core verb (`getRecord`, `getTree`, `addChild`, …) on every element + child edge  |
| `coverage: deep`                   | a deep nested `getTree({select})` — the recursive `TreeSelect` cost                    |
| `coverage: api`                    | the **full method surface incl. extensions** (`history`, `reference`, `dataModel`, …)  |

The `bench` console also prints each `coverage:` scenario as a **delta over `baseline (import)`** — that's the "what this feature adds" number:

```
[v2019C1]  | Scenario               | Instantiations | Check |
           | baseline (import)      | 107,196        | 1.0s  |
           | coverage: calls        | 259,873        | 2.9s  |
           | coverage: api          | 136,497        | 1.0s  |
             coverage: calls        +152,677
             coverage: api          +29,301
```

Rule of thumb: lower is better; the gate only fires when a number climbs **> 5%** above the same scenario at the base, and no `Type cost:` line of the change explains it.

## How to read `readability-audit.md`

A committed snapshot (dialects only) of what an editor shows when you hover each method/type — sorted worst-first. It is **not gated**; read it in review to see whether a change made hovers noisier.

| Member                     | len   | members | causes          |
| -------------------------- | ----- | ------- | --------------- |
| `q.getAttributes(…) param` | 3,510 | 0       | C1 module-noise |

- **`len`** — characters in the rendered type (proxy for hover size; bigger = noisier).
- **`members`** — how many element-union members show up.
- **`causes`** — the matched root cause(s):
  - **C1 module-noise** — `import("…/extensions/…")` paths leak into the render.
  - **C2/C4 element-union** — the full ~200-element name union appears.
  - **C3 wide-input-union** — a wide multi-member input union, each member expanded.
  - **C5 record-seam** — a record shows as `RawRecord<…> & { status }` instead of one clean object.
  - **C6 recursive** — self-referential `TreeRecord` / `TreeSelect`.

Most of these are inherent to a config-driven DSL of this size and are bounded by TypeScript itself; the audit exists to **track** them, not to fail a build.

## When a gate goes red — what to do

**`type-narrowing` red.** A narrowing guarantee broke. The output points at the failing assertion in `narrowing.generated.test-d.ts`. Fix the type so narrowing is restored (this is the gate doing its job — a consumer would have lost IntelliSense). The assertions are regenerated from the schema every run, so a _legitimate_ schema change won't false-alarm here.

**`type-bench` red.** A scenario crossed +5%. Decide:

1. **Unintended** (you didn't mean to add cost) → simplify the types; re-run `npm run type-bench:check` until green.
2. **Intentional / acceptable** → explain it in the change: a line `- Type cost: <why>` in its changelog fragment (or `Type cost: <why>` in its no-entry note). A line already at the base explains nothing.

## What these gates do **not** catch

Be aware of the blind spots — none of these are failures of the tooling, just its scope:

- **Exact extension return types.** Narrowing asserts _core_ machinery and that the full surface _compiles_ — it does not pin, say, `getSortedHitems → TrackedRecord<'Hitem'>[]`. A type-sound-but-different extension change passes. Your **app's own `tsc` check** (e.g. its `check` script) is the backstop, or add a small hand-written `*.test-d.ts` to pin specific domain types.
- **Sub-5% drift.** Each change is measured against its own base, so small regressions can add up across changes; `dialecte bench --base <name>@v<x.y.z>` reports the cost since a release.
- **TypeScript version bumps.** Instantiation counts are deterministic _for a fixed `tsc`_; both trees are measured with the head's compiler, so a bump compares like with like.

## Adding the gates to a new dialect

A dialect needs only a dev-dependency on `@dialecte/cli`, the four scripts above, a `tsconfig.bench.json`, and the `_type-perf.yml` workflow — everything else (namespace, versions, probes) is discovered. See `@dialecte/scl` for the reference setup.
