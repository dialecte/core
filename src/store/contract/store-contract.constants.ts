import type {
	StoreContractNeed,
	StoreContractTable,
	StoreContractTag,
	TransportCase,
} from './store-contract.types'
import type { DiagnosticCatalogue } from '@/diagnostics'
import type { HubConnection } from '@/store/sqlite/served/hub/hub-client.types'
import type { FakePage } from '@/store/sqlite/served/hub/hub.fixtures.types'

/** The tag whose records the contract's import session asks for; every other record passes it by. */
export const CONTRACT_SESSION_TAG = 'B'

/** A record of the session's tag whose `bB` attribute holds this value makes the session fail. */
export const CONTRACT_SESSION_FAIL_VALUE = 'fail'

/** A record of the session's tag whose `bB` holds this value gets a diagnostic whose `meta` holds a function. */
export const CONTRACT_SESSION_FUNCTION_VALUE = 'function'

/** A record of the session's tag whose `bB` holds this value gets a diagnostic whose `meta.note` holds a lone surrogate. */
export const CONTRACT_SESSION_LONE_SURROGATE_VALUE = 'lone-surrogate'

/** A record of the session's tag whose `bB` holds this value is created again by the session, under its own id. */
export const CONTRACT_SESSION_REUSE_VALUE = 'reuse'

/** A record of the session's tag whose `bB` holds this value makes the session wait for the case's release. */
export const CONTRACT_SESSION_HOLD_VALUE = 'hold'

/** Between the hold value and a hold's id in a file (`hold:<id>`), and in the hold's channel name. */
export const HOLD_ID_SEPARATOR = ':'

/** The channel a held import and its case talk on (one per hold), whatever realm the import runs in. */
export const CONTRACT_HOLD_CHANNEL = 'dialecte::store-contract::hold'

/**
 * Where a contract engine worker tells each client gone it was told of, once it has aborted that client's imports
 * and exports: a case releases a held import of a client it removed only then, or the import may complete first.
 */
export const CONTRACT_CLIENT_GONE_CHANNEL = 'dialecte::store-contract::client-gone'

/** The attribute the contract's import session writes on every record of its tag, after the parse. */
export const CONTRACT_SESSION_SEEN_ATTRIBUTE = 'seen'

/** What the contract's import session says: one diagnostic per record of its tag it was handed. */
export const CONTRACT_SESSION_DIAGNOSTICS = {
	source: 'store-contract',
	codes: {
		seen: { severity: 'information', family: 'import', message: 'Record handed to the session' },
	},
} as const satisfies DiagnosticCatalogue

/** What the export cases import: a document every element of which keeps what it was written with. */
export const CONTRACT_EXPORT_SOURCE =
	'<A aA="1"><AA_1 aAA_1="x">text value</AA_1></A><C aC="2"><CC_1 aCC_1="fixed_val"/></C>'

/** `CONTRACT_EXPORT_SOURCE` in the download layout: 4 spaces, CRLF, a text value on its element's line. */
export const CONTRACT_EXPORT_FORMATTED = [
	'<?xml version="1.0" encoding="UTF-8"?>',
	'<Root xmlns="http://dialecte.dev/XML/DEFAULT">',
	'    <A aA="1">',
	'        <AA_1 aAA_1="x">text value</AA_1>',
	'    </A>',
	'    <C aC="2">',
	'        <CC_1 aCC_1="fixed_val"/>',
	'    </C>',
	'</Root>',
].join('\r\n')

/** A write during an export lands once this many records are written: the root, `A` and `AA_1`, before `C` is read. */
export const WRITE_AFTER_RECORDS = 3

/**
 * Arrays and objects above an attribute's value in a write of records or patches: the write's list,
 * the record or the patch, its attributes, the attribute.
 */
export const CONTRACT_LEVELS_ABOVE_ATTRIBUTE_VALUE = 4

/** Arrays and objects above a metadata field's value in a document registered or updated: the document, its metadata. */
export const CONTRACT_LEVELS_ABOVE_METADATA_VALUE = 2

/** The engine of the contract dialecte, served from a worker as a dialecte's worker entry serves it. */
export const CONTRACT_ENGINE_URL = new URL('./store-contract.worker.ts', import.meta.url).href

/** A byte order mark: what a UTF-8 decoder may drop where a text begins with it. */
export const CONTRACT_BYTE_ORDER_MARK = '\u{FEFF}'

/**
 * Well-formed texts at the edges of what a store's text encoding may change, each kept as written by every
 * store: written as every value and at the start of every other text a store keeps (a leading byte order
 * mark is what a UTF-8 decoder may drop).
 */
export const KEPT_TEXTS: Readonly<Record<string, string>> = {
	'the empty text': '',
	'a leading byte order mark': CONTRACT_BYTE_ORDER_MARK,
	'a surrogate pair': '\u{1D11E}',
	'the replacement character': '\u{FFFD}',
	NUL: '\u0000',
	'a line separator': '\u{2028}',
	'the last code point of the first plane and of the last': '\u{FFFF}\u{10FFFF}',
	'a decomposed letter (NFD)': 'e\u{301}',
	'CR LF and a tab': '\r\n\t',
	'quotes and a backslash': `"'\\`,
}

/**
 * A text value beginning with a byte order mark, holding a no-break space and ending with a line separator:
 * characters JavaScript counts as whitespace and XML does not, kept as written through an import and an export.
 */
export const CONTRACT_NOT_XML_WHITESPACE_TEXT = '\u{FEFF}a\u{A0}b\u{2028}'

/** An attribute value holding a no-break space and a line separator: read as written, every character kept. */
export const CONTRACT_NOT_XML_WHITESPACE_ATTRIBUTE = 'a\u{A0}b\u{2028}c'

/** A vertical tab: a character XML does not allow, as written or as a character reference (`&#11;`). */
export const CONTRACT_NOT_XML_CHARACTER = { text: '\u{B}', reference: '&#11;', name: 'U+000B' }

/** A text value padded and split by XML whitespace, as an import reads it: trimmed, the inner run one space. */
export const CONTRACT_XML_WHITESPACE_TEXT = { written: ' \t\r\n a \n\t b \r\n', read: 'a b' }

/** Text holding a lone surrogate: an id or a tag name a case looks up, or a value a case hands a store. */
export const CONTRACT_LONE_SURROGATE_TEXT = 'x\uD800y'

/** `CONTRACT_LONE_SURROGATE_TEXT`, its lone surrogate replaced by U+FFFD (as a UTF-8 encoder writes it). */
export const CONTRACT_REPLACED_TEXT = 'x\u{FFFD}y'

/** Where a case tells the contract's engine workers to end, by project: an engine ended mid-import. */
export const CONTRACT_ENGINE_CHANNEL = 'dialecte::contract-engine'

/** Between two looks at an ended engine's lock. */
export const ENGINE_END_POLL_MS = 50

/** Why a leg that imports in the page has no engine a case can end mid-import. */
export const IN_PAGE_IMPORT_REASON =
	'this store imports in the page itself: no engine to end mid-import, short of the page'

/** The parts of the port a leg may have pending (the others a case needs are set-ups or differences). */
export const STORE_CONTRACT_FEATURES = ['history', 'blobs', 'import', 'export'] as const

/**
 * What a leg may answer otherwise by design: an engine ended mid-import (`engine-end`: a store with no
 * engine of its own has none to end); a project of the name under another dialecte (`dialecte-key`: a
 * store named by the project's name alone has no other dialecte's); a view away while its project is
 * destroyed elsewhere (`away`: a store whose connections all count until closed never has one away); the
 * changes told to every connection (`announce`: a store that tells none leaves it to the project's channel).
 */
export const STORE_CONTRACT_DIFFERENCES = [
	'engine-end',
	'dialecte-key',
	'away',
	'import-liveness',
	'announce',
] as const

/** Why the IndexedDB leg announces nothing itself (`subscribe`): the project's channel does it for it. */
export const ANNOUNCED_BY_PROJECT_REASON =
	"IndexedDB keeps no connection list to tell: a project on it announces its own changes on the project's BroadcastChannel, which every project of the name hears (until it moves to SQLite)"

/** The dialecte a case's store of another dialecte runs (the runtime fixture's `other-dialecte` engine serves it). */
export const CONTRACT_OTHER_DIALECTE_ID = 'core/test-other'

/** How long a case waits for a promise before it calls it pending. */
export const OUTCOME_WAIT_MS = 200

/** Why the in-process leg has no engine a case can end mid-import. */
export const IN_PROCESS_ENGINE_REASON =
	'the in-process engine runs in the page itself: nothing ends it mid-import, short of the page'

/** How long a contract engine told to end may take to let its lock go. */
export const ENGINE_END_BUDGET_MS = 5_000

/** Why a leg's view is never away while its project is destroyed: every connection counts until closed. */
export const AWAY_UNREACHABLE_REASON =
	'its connections run in the page and each counts until closed: a destroy is refused while any is open, so none is ever away'

/** The page each realm of the hub leg runs on. */
export const REALM_PAGES = new WeakMap<HubConnection, FakePage>()

/** The tag of the cases about what crosses between a client and its engine. */
export const TRANSPORT_TAG: StoreContractTag = 'transport'

/**
 * What makes a case a transport case: a second connection, the announcements, an engine ending or away, another
 * dialecte's project, an import's liveness, a full storage, an import or an export (listeners and aborts cross the port).
 */
export const TRANSPORT_NEEDS: readonly StoreContractNeed[] = [
	'second-connection',
	'announce',
	'away',
	'engine-end',
	'dialecte-key',
	'import-liveness',
	'full-storage',
	'import',
	'export',
]

/**
 * The groups whose every case is a transport case: imports and exports (listeners and aborts cross the port), and text
 * across the port (kept as written, keys that are not well-formed, characters XML does not allow).
 */
export const TRANSPORT_GROUPS: readonly { table: StoreContractTable; group: string }[] = [
	{ table: 'store', group: 'importing a file' },
	{ table: 'store', group: 'an edit during an import' },
	{ table: 'export', group: 'exporting a document' },
	{ table: 'export', group: 'a write during an export' },
	{ table: 'export', group: 'refused exports' },
	{ table: 'text', group: 'text kept as written' },
	{ table: 'text', group: 'a key that is not well-formed names nothing' },
	{ table: 'text', group: 'a character XML does not allow is never imported nor exported' },
]

/**
 * Cases run behind a port though no need or group makes them transport cases: each reaches a member of the engine's
 * wire no other transport case calls (the worker and hub legs check every member is called).
 */
export const TRANSPORT_CASES: readonly TransportCase[] = [
	{
		table: 'store',
		group: 'blobs',
		description: 'getStandaloneBlobs returns the blobs attached to nothing',
		reaches: 'getStandaloneBlobs',
	},
]

/** The tables of value shapes and paths: what they check is the same on every port, they run in-process only. */
export const IN_PROCESS_ONLY_TABLES: readonly StoreContractTable[] = ['path', 'well-formed']

/** The variable that runs the full table on every leg (a release): `1` or `true`. */
export const FULL_TABLE_VARIABLE = 'STORE_CONTRACT_FULL_TABLE'

/** The values of the full-table variable that run the full table. */
export const FULL_TABLE_ON: readonly string[] = ['1', 'true']

/** The values of the full-table variable that leave the legs behind a port on their subset (empty: not set). */
export const FULL_TABLE_OFF: readonly string[] = ['', '0', 'false']

/** The name every store of the worker leg starts with: its leftover pools are told from the hub leg's running beside it. */
export const WORKER_LEG_PREFIX = 'store-contract-worker'

/** The name every store of the hub leg starts with. */
export const HUB_LEG_PREFIX = 'store-contract-hub'

/**
 * How long one case of a leg in the test's own realm may take: a few ms to a few hundred at rest (fake IndexedDB's
 * connection cases the slowest), many times that on a loaded machine.
 */
export const IN_REALM_CASE_TIMEOUT_MS = 30_000
