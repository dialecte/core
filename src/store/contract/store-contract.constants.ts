import type { DiagnosticCatalogue } from '@/diagnostics'

/** The tag whose records the contract's import session asks for; every other record passes it by. */
export const CONTRACT_SESSION_TAG = 'B'

/** A record of the session's tag whose `bB` attribute holds this value makes the session fail. */
export const CONTRACT_SESSION_FAIL_VALUE = 'fail'

/** A record of the session's tag whose `bB` holds this value gets a diagnostic whose `meta` holds a function. */
export const CONTRACT_SESSION_FUNCTION_VALUE = 'function'

/** A record of the session's tag whose `bB` holds this value gets a diagnostic whose `meta.note` holds a lone surrogate. */
export const CONTRACT_SESSION_LONE_SURROGATE_VALUE = 'lone-surrogate'

/** A record of the session's tag whose `bB` holds this value makes the session wait for the case's release. */
export const CONTRACT_SESSION_HOLD_VALUE = 'hold'

/** Between the hold value and a hold's id in a file (`hold:<id>`), and in the hold's channel name. */
export const HOLD_ID_SEPARATOR = ':'

/** The channel a held import and its case talk on (one per hold), whatever realm the import runs in. */
export const CONTRACT_HOLD_CHANNEL = 'dialecte::store-contract::hold'

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

/** How many times the hub leg asks a destroy that another realm's leave, still on its way, may refuse. */
export const HUB_DESTROY_ASKS = 20

/** Between two such asks. */
export const HUB_DESTROY_ASK_INTERVAL_MS = 100

/** Why a leg that imports in the page has no engine a case can end mid-import. */
export const IN_PAGE_IMPORT_REASON =
	'this store imports in the page itself: no engine to end mid-import, short of the page'

/** The parts of the port a leg may have pending (the others a case needs are set-ups or differences). */
export const STORE_CONTRACT_FEATURES = ['history', 'blobs', 'import', 'export'] as const

/**
 * What a leg may answer otherwise by design: an engine ended mid-import (`engine-end`: a store with no
 * engine of its own has none to end).
 */
export const STORE_CONTRACT_DIFFERENCES = ['engine-end'] as const

/** How long a case waits for a promise before it calls it pending. */
export const OUTCOME_WAIT_MS = 200

/** Why the in-process leg has no engine a case can end mid-import. */
export const IN_PROCESS_ENGINE_REASON =
	'the in-process engine runs in the page itself: nothing ends it mid-import, short of the page'

/** How long a contract engine told to end may take to let its lock go. */
export const ENGINE_END_BUDGET_MS = 5_000
