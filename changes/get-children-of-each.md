### Added

- `query.getChildrenOfEach(refsOrRecords, { tagName })`: the children of one tag of many parents at once, one list per input position in the input order, each as `getChildren` answers it, through `transparentElements` included. It makes at most three store `getMany` calls whatever the number of parents (the parents, then their direct children and wrappers, then the children inside the wrappers) instead of two to four reads per parent (1,000 parents through their wrappers: 3 store reads, 3,000 records). A record given is used as given (its `children` are followed, it is not read again); a ref is read, all refs in one call. A parent that names no element answers `[]`. Works on every store, staged operations included; also as `query.any.getChildrenOfEach`.
- `STORAGE_KINDS_VERSION` is 5: the shared `Query` shape gained `getChildrenOfEach`, so a copy of the library at version 4 finds no storage kind registered by this one (`PROJECT_STORAGE_NOT_REGISTERED`) instead of a store whose query it cannot call.

### Changed

- `query.getChildren` reads through `getChildrenOfEach` for its one parent: same answers, the parent still read from its ref, and in dev perf counters its parent read is now one `core::store::getMany` instead of one `core::store::get` (records read unchanged). Scenario "one fetch over the leaves of a subtree": `get` 32 → 16, `getMany` 208 → 224, the same 240 records moved.
