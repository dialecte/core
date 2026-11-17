### Added

- Dev perf tallies the records each store read of the query layer moves, beside its call: `core::store::records.get`, `records.getMany`, `records.getByTagName` and `records.getByDocumentId` (an id the store does not hold moves none). A read through a worker costs per record it moves, which the call tally alone hides.
