### Added

- `getTree` takes `expanded: ReadonlySet<string>`: only the listed ids open, one level each, starting from the root. Every other node keeps its `children` refs with an empty `tree`, as past `depth`, and a listed id under a node that does not open is never read. One call rebuilds a lazy tree view's open frontier (an open state restored, a reload after an `unknown` commit, a target revealed with its ancestors listed): the root, then one store read per open level, never the whole document, on the document root too. The tree is the full `getTree` with every node not opened cut to an empty `tree`.

### Changed

- `getTree`'s `depth` counts the levels the caller sees: an element `unwrap` hoists (by default the dialecte's transparent elements) no longer uses up a level, so `depth: 1` on a parent of a transparent wrapper answers the wrapper's children too, each with an empty `tree`. With `unwrap: []` every element counts, as before.
- `getSnapshot`'s `depth` is unchanged and still counts stored levels, a hoisted element included: it bounds the records the XML is written from too, so it no longer matches `getTree`'s `depth` under a transparent element.
- `STORAGE_KINDS_VERSION` is 13: the shared `Query` shape gained `getTree`'s `expanded`, so a copy of the library at another version finds no storage kind registered by this one (`PROJECT_STORAGE_NOT_REGISTERED`) instead of a store whose query takes an option it does not know.
