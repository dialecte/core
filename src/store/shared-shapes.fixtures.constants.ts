import ts from 'typescript'

/** How the checker writes a type: whole (no `...`), named types by their names. */
export const WRITTEN = ts.TypeFormatFlags.NoTruncation
/** How the checker writes a type alias's own definition: its first level written out. */
export const WRITTEN_AS_ALIAS = ts.TypeFormatFlags.NoTruncation | ts.TypeFormatFlags.InTypeAlias

/** How long asking git whether it tracks a recorded shape may take: a hung git fails the guard, never holds it. */
export const GIT_LS_FILES_TIMEOUT_MS = 10_000

/** The exit status of `git ls-files --error-unmatch` for a file it does not track. */
export const GIT_NOT_TRACKED = 1

/** The exit status of git asked outside any repository. */
export const GIT_NOT_A_REPOSITORY = 128
