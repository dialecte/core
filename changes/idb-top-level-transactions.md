### Fixed

- The IndexedDB store no longer fails a read or a write with `PrematureCommitError: Transaction committed too early` under load. Each store transaction now opens at the top level and hands its work the transaction's own tables, so every request stays in that transaction even when Dexie loses track of it across an `await`. Parallel reads, such as two queries of one document started together, no longer fail.
