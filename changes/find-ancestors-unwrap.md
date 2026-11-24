### Changed

- **Breaking** - `findAncestors` and `findAncestorsOfEach` (on `query`, `tx` and `any`) walk through the dialecte's transparent elements and leave them out of the result, as `getTree` and `getSnapshot` unwrap them: a transparent element takes no `depth` level and `stopAtTagName` never matches it. A caller that needs the wrapper in the chain (to read child positions from its parent, to find the wrapper itself, or to follow `record.parent` through the result) passes `unwrap: []`, which answers every stored ancestor as before; `any.findAncestors` takes no options, so such a caller moves to `query.findAncestors(ref, { unwrap: [] })`.

- **Breaking** for library copies: `STORAGE_KINDS_VERSION` is 17 (was 16): the shared shape gained `FindAncestorsOptions.unwrap`, so a copy of the library at another version finds no storage kind registered by this one (`PROJECT_STORAGE_NOT_REGISTERED`). Stored data is unchanged: existing projects open as they are. Every package of an app must resolve the same core version.

### Added

- `FindAncestorsOptions.unwrap`: the elements the ancestor reads walk through and leave out (default: the dialecte's `transparentElements`), the same option `getTree` and `getSnapshot` take.
