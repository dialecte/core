<!-- dialecte-skills workspace -->

# Code rules for dialecte repos

These are review-blocking. Each has a reason; the reason tells you what to do in a case the rule
does not name.

## Contents

- Reuse and sources of truth
- Function shape
- Files and types
- Naming
- Comments and committed text
- Self-check before hand-over

## Reuse and sources of truth

- **Search before every helper**, test tooling included. Grep the concern in
  `extensions/*/{query,transaction}/index.ts`, `hooks/*`, `hooks/shared/`, core `helpers/` and
  `utils/`. When you add a function, be ready to name the existing method that could replace it
  and why it does not fit.
- **No new source of truth.** Before declaring a list (`const X = [...] as const`) look for it in
  the definition (`ATTRIBUTES`, `CHILDREN`, `PARENTS`, identity fields, keyrefs) or in a registry
  (its keys, its `target` tags). Declare only what neither knows, and declare it once: types derived
  from the runtime list. A table that repeats registry content drifts silently.
- **Read derived views at the use site** instead of copying them; never `const LOCAL = GLOBAL` just
  to rename.
- **Repeated literals and tag sets** go to the package `constants/` and are imported everywhere;
  derive the union type with `(typeof LIST)[number]`.
- **Use Dialecte's attribute API**: `query.getAttributes(ref)` / `getAttribute(ref, { name })`, or
  `readAttribute(s)` without a query. No `record.attributes.find(...)` helpers.
- **Accept a `query` / `tx`** in domain functions so they reuse the primitives, rather than taking
  pre-fetched data and re-implementing lookups.

## Function shape

- **Object parameters.** `fn(query, { targetParent, tagName, matchKey })`, not positional. The only
  thing outside the object is a leading `query` / `tx`. A positional signature (a single obvious
  `ref`, a symmetric `equals(a, b)`) is discussed with the maintainer first.
- **Named `function` declarations**, also for local helpers. Arrows only for tiny inline callbacks
  (`.map`, `.filter`, `.some`). A closure over a local value becomes a module-level named function
  taking that value as a parameter.
- **No `await` nested in an argument.** `const instances = await findInstances(query, {...})`,
  then pass `instances`.
- **Immutable, explicit.** Return new values, no hidden state, no mutation of records you received.
- **Never `any`.** Use the `Any*` core types (`AnyDialecteConfig`, `AnyRawRecord`, ...) in core, the
  hydrated domain types (`<Name>.*`) in a dialecte package. Narrow types as far as they go.
- **Extension methods** take `Core.Query<Config>` / `Core.Transaction<Config>` as first parameter
  (not the hydrated `<Name>.Query`: type cycle). A sibling is called by import, passing the same
  query. A helper not exported from the folder's `index.ts` is not a method.

## Files and types

- **One function per file**, test co-located: `<name>.ts`, `<name>.test.ts`.
- **Types live in `<name>.types.ts`** next to the code - never exported or domain types inline in
  the implementation file. Exception: no `.types.ts` for a one-line alias that just renames an
  existing type; use the underlying type directly.
- **Module constants live in `<name>.constants.ts`** (or the extension's `constants/`).
- **Group by domain, not by technical layer.** Types folders hold only definitions.
- **Zero runtime cost** for type machinery; watch the type bench when adding generic types.

## Naming

- Full, readable camelCase words: `attribute`, not `attr`; `(attribute) => attribute.name`, not
  `(a) => a.name`. Existing API names like `ref` are fine; your own variables say what they are.

## Comments and committed text

- Explain the behaviour so the comment stands on its own; a reader without your plan or ticket
  must understand it.
- **No plan, lot, phase, ticket or acceptance-criterion tags** (a step id, a lot number, an
  acceptance-criterion id, an issue number) in code, comments, tests, docs, CHANGELOG or commit messages. They belong in plans and PR
  descriptions.
- **No citations of a standard** (a document name with a clause, table, annex or section number)
  in any committed file, commit message, issue, PR or
  review comment. Write the rule itself ("a name stays unique among its siblings"). Citations
  live only in uncommitted plan notes. Naming the standard a library implements (site tagline, the
  XSD it is generated from, the namespace prefixes of the schema, the schema's version ids) is not a citation. Never quote the standard's text anywhere (copyright).
- Do not create documentation that was not asked for, beyond the docs + CHANGELOG the Definition
  of Done requires.

## Self-check before hand-over

```bash
npx dialecte rules              # the files changed against HEAD and the new ones
npx dialecte rules <files...>   # or the files you name; --json for a program
```

It reads each file's syntax tree, not lines: an exported type outside a `*.types.ts` file, a module
constant outside a `*.constants.ts` file, a function declared as a `const`, an `await` inside an
argument, a plan or ticket tag or a standard citation (the package's own patterns included) are
errors; positional parameters beyond a leading `query` / `tx` and abbreviated names are warnings. Fix
every error; answer every warning (fix it, or say in the hand-over why the shape is right). It exits 1
on an error. A finding that is wrong is a cli bug: report it, do not work around it.

`rules` comes with `@dialecte/cli` 0.2.0 or later. Without it, the same checks as greps (not
tests/types/constants files for the first two); the last two mirror the patterns `rules` and
`handover` share (the cli's committed-text constants):

```bash
grep -nE '^(export )?type [A-Z]|^(export )?interface ' <impl files>    # inline types?
grep -nE '^const [A-Z_]+ ' <impl files>                                # module constants outside *.constants.ts?
grep -nE 'const [a-zA-Z]+ = (async )?\(' <files>                       # arrow-function declarations?
grep -nE '\((await |.*, await )' <files>                               # await inside an argument?
grep -nE '\blot [A-Z0-9]|\bAC[0-9]|#[0-9]{3,}\b' <files>               # plan / ticket tags?
grep -nE '§ ?[0-9]|Tables? [0-9]|Annex [A-Z]|[Cc]lause [0-9]' <files>  # standard citations? (a dialecte's skill adds its standard's names)
```
