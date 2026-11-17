### Added

- `query.findAncestorsOfEach(refsOrRecords, options?)`: the ancestors of many elements at once, one list per input position in the input order, with the options of `findAncestors` (`depth`, `stopAtTagName`, `order`) applied to each element. It reads one store `getMany` per ancestor level instead of one read per level per element: an ancestor shared by several elements is read once (1,000 leaves four levels deep: 5 store reads). A record given is used as given (its `parent` is followed, it is not read again); a ref is read, all refs in one call. A ref that names no element answers `[]`. Works on every store, staged operations included; also as `query.any.findAncestorsOfEach` (bottom-up, no options). A parent cycle in a corrupt store ends the chain instead of looping.
- `STORAGE_KINDS_VERSION` is 4: the shared `Query` shape gained `findAncestorsOfEach`, so a copy of the library at version 3 finds no storage kind registered by this one (`PROJECT_STORAGE_NOT_REGISTERED`) instead of a store whose query it cannot call.

### Changed

- `query.findAncestors` walks through `findAncestorsOfEach` for its one element: same answers, and in dev perf counters each store read is now one `core::store::getMany` per level instead of one `core::store::get` (records read unchanged, the start element still read from its ref).
