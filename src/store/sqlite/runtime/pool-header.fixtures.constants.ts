// sqlite-wasm's header layout and SQLite's flags, written out here: the tests do not lean on the constants they check
export const HEADER_BYTES = 4096
export const HEAD_BYTES = 524
export const FLAGS_OFFSET = 512
export const DIGEST_OFFSET = 516
export const DELETE_ON_CLOSE = 0x8
export const DIGEST_V2 = 0x80
export const MAIN_DB = 0x100
export const MAIN_JOURNAL = 0x800
export const DATA = HEADER_BYTES + 8192
