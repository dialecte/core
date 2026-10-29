/**
 * A character XML does not allow in a document, written or as a character reference, that a well-formed string can
 * hold: a control character below U+0020 other than tab, line feed and carriage return, U+FFFE, U+FFFF. (A lone
 * surrogate, the rest of what XML forbids, is not well-formed text: every store refuses it.)
 */
// oxlint-disable-next-line no-control-regex - matching the control characters XML forbids is the point
export const NOT_XML_CHARACTER = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/

/** A byte order mark: a file may begin with it; it is no part of the XML that follows. */
export const BYTE_ORDER_MARK = '\u{FEFF}'
