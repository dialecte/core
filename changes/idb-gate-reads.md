### Fixed

- On IndexedDB, a read (a record, the documents, a blob, a document's version, its history or its changelog) no longer fails with "Database has been closed" when it runs while the store makes its connection again (an open after a close, another tab's change to the database): it waits for the new connection and answers from it.
- On IndexedDB, a write to a document another tab registered while this store was making its connection again is no longer refused `DOCUMENT_NOT_REGISTERED`: the store's list of documents is read once its new connection is ready.
- On IndexedDB, reading a blob whose document's tables are gone (an inconsistent registry) answers no blob instead of throwing.
- On IndexedDB, a write started while a closed store is opened again, before its connection is made again, lands on the new connection; `reconcile()` and `isDocumentReadable` wait for a reload of the connection that runs.
