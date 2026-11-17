### Added

- `Store.readVersioned({ documentId, read })` (optional): one read member's answer and the document's version, read in the same step. `read` names the member (`get`, `getMany`, `getByTagNameInDocument`, `getByAttributes`, `getByDocumentId`) and its arguments as plain data; the answer is `{ value, version }`, `version` a `StoreVersion` (`{ engineId, count }`). Equal versions mean the document did not change between two answers; any write that changes what a read answers, from this connection or another tab, gives a new version. This lets a read scope notice another tab's commit even when the message telling it was missed.
- The SQLite store serves it on every link: in the page, in a worker and through the hub. Its version counts the engine's writes per document (bulk writes, commits, undo, redo, removals and the writes of an import) and carries an id drawn when the engine starts, so a restarted engine never repeats an older version.

### Changed

- `ENGINE_WIRE_PROTOCOL` is 5, `HUB_PROTOCOL_VERSION` 9 and `STORAGE_KINDS_VERSION` 8: the engine serves `readVersioned` over its wire and the store port gained the member, so a page and an engine (or a storage kind) of different versions refuse each other instead of failing on the member.
