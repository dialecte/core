import type { DiagnosticCatalogue } from '@/diagnostics'

/** The tag whose records the contract's import session asks for; every other record passes it by. */
export const CONTRACT_SESSION_TAG = 'B'

/** A record of the session's tag whose `bB` attribute holds this value makes the session fail. */
export const CONTRACT_SESSION_FAIL_VALUE = 'fail'

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
