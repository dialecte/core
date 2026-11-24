### Fixed

- On IndexedDB, a write no longer fails with "Invalid table argument" or "Database has been closed" when the store opens again or another tab changes the database while the write runs: the write waits for the store's connection and lands. A write to a document another tab removed meanwhile is refused `DOCUMENT_NOT_REGISTERED`, no longer `STORE_COMMIT_FAILED` or a raw error.
- On IndexedDB, two undos (or two redos) of one document at once now step two changes, never the same one twice.
