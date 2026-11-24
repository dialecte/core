### Fixed

- On IndexedDB, a write no longer fails with "Invalid table argument" or "Database has been closed" when it runs while the store reopens its connection (an open after a close, another document registered, another tab's change to the database): it waits for the new connection and lands. Opening a store that is already open keeps its connection.
- On IndexedDB, a commit or a bulk write to a document another tab removed meanwhile is refused `DOCUMENT_NOT_REGISTERED`, no longer `STORE_COMMIT_FAILED` or a raw error; an undo or a redo of it answers `false`, nothing to step, as for any document not registered.
- On IndexedDB, two undos (or two redos) of one document at once now step two changes, never the same one twice.
