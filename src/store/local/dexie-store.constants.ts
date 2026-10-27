/** The Web Lock a local-store import holds while it runs: `<prefix><store name>:<writeId>`. */
export const IMPORT_LOCK_PREFIX = 'dialecte:local-import:'

/** The `_meta` key prefix of a document's version row: `<prefix><documentId>`. */
export const VERSION_KEY_PREFIX = 'writes:'

/** The sequence number of a changelog entry a commit discarded (undone, then a commit came): it only keeps its write id. */
export const DISCARDED_SEQUENCE = -1
