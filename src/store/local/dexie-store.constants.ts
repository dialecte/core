import { createClosingConnections } from '../closing-connections'
import { createOpenConnections } from '../open-connections'

import type { RecordSchema } from '../store.types'

/**
 * The Web Lock every open connection to a local store holds shared, `<prefix><store name>`: a destroy
 * asks for it alone, so it is refused while another connection - of any tab - is open. A connection
 * closed with operations running holds it until they end.
 */
export const OPEN_LOCK_PREFIX = 'dialecte:local-open:'

/**
 * How long a destroy waits for the open lock alone: a connection closed just before lets it go
 * asynchronously. Still held after that, the destroy is refused.
 */
export const DESTROY_LOCK_WAIT_MS = 500

/** Between two asks for the open lock alone while a destroy waits. */
export const DESTROY_LOCK_ASK_INTERVAL_MS = 50

/** The Web Lock a local-store import holds while it runs: `<prefix><store name>:<writeId>`. */
export const IMPORT_LOCK_PREFIX = 'dialecte:local-import:'

/** The `_meta` key prefix of a document's version row: `<prefix><documentId>`. */
export const VERSION_KEY_PREFIX = 'writes:'

/** The sequence number of a changelog entry a commit discarded (undone, then a commit came): it only keeps its write id. */
export const DISCARDED_SEQUENCE = -1

/** The local connections of each name open in this realm: the count a destroy reads where there are no Web Locks. */
export const OPEN_LOCAL_CONNECTIONS = createOpenConnections()
/** The local connections of each name closed with operations running, in this realm: a destroy of the name lets them complete first. */
export const CLOSING_LOCAL_CONNECTIONS = createClosingConnections()

/** The destroys of each name in this realm, in turn: settled when the last one called has. */
export const LOCAL_DESTROY_TURNS = new Map<string, Promise<void>>()

/** Default minimal schema when none provided */
export const DEFAULT_RECORD_SCHEMA: RecordSchema = {
	primaryKey: 'id',
	indexes: ['tagName'],
	compoundIndexes: [],
	arrayIndexes: [],
}
