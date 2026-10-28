# Lot: JSDoc links in the generated API index

Goal: the API index that `dialecte skills generate` writes shows a method's summary and its `@intent` texts
without raw JSDoc link syntax. `{@link X}` and `{@linkcode X}` render as `` `X` ``; `{@link X | label}` renders
as the label.

Scope: `src/lib/render-links.ts` (new) and its call in `src/lib/discover.ts`, where each method's summary and
intent texts are read. Out of scope: the index layout.

Red cases to start from: a plain link, a labelled link, a linkcode, text without links.
