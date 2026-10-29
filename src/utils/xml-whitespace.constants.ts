/** The four characters XML counts as whitespace, by UTF-16 code unit: no other Unicode space is one. */
export const XML_SPACE = 0x20
export const XML_TAB = 0x09
export const XML_CARRIAGE_RETURN = 0x0d
export const XML_LINE_FEED = 0x0a

/** A run of XML whitespace: space, tab, carriage return and line feed only. */
export const XML_WHITESPACE_RUN = /[ \t\r\n]+/g
