### Changed

- The in-memory store answers a tag read from a tag index it keeps per document on every write (bulk write, commit, undo, redo, import, document removal): a read walks the records of the tag, not the whole document, and answers in id order as before. On a generated 50 MB document (912,963 records), a one-record tag reads in 0.02 ms instead of 8.6 ms. Its answers are copied by a copier made for the record's shape, faster than `structuredClone`; a caller changing a record it read still changes nothing the store holds.
