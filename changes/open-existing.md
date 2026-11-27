### Added

- `project.open(name, { create: false })` opens a project that must already exist: one never made, destroyed, or whose storage was cleared (its SQLite files or IndexedDB database removed) is refused `PROJECT_NOT_FOUND` (D7019, `meta.project`) on every store, nothing made in its place. A project made and still empty opens. `Store.open(options?: StoreOpenOptions)` takes the same `{ create }` option, so a custom store implements it too (the store contract suite checks it). The default `open(name)` still makes a missing project, empty.

### Changed

- The hub protocol (14), the engine wire (10) and the storage kinds shape (19) carry the new option: a page running an older copy of core is refused at the hub hello, as with any protocol change.
