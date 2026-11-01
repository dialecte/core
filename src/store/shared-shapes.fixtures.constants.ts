import ts from 'typescript'

/** How the checker writes a type: whole (no `...`), named types by their names. */
export const WRITTEN = ts.TypeFormatFlags.NoTruncation
/** How the checker writes a type alias's own definition: its first level written out. */
export const WRITTEN_AS_ALIAS = ts.TypeFormatFlags.NoTruncation | ts.TypeFormatFlags.InTypeAlias
