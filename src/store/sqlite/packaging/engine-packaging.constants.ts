/**
 * How long a case reading a build or starting a dev server may take: files read from disk and a server listening, a few
 * seconds on a loaded machine - a bound for a hang, never a measure of speed.
 */
export const PACKAGING_CASE_TIMEOUT_MS = 30_000

/** The engine's chunk: built beside the entries, named in no export, reached from the SQLite entry by `import()` only. */
export const ENGINE_CHUNK = 'sqlite-engine.js'

/** A text only the engine holds (what it says of the projects its worker serves): where its code went in a build. */
export const ENGINE_ONLY_MARKER = 'one project per worker'

/**
 * How long a case type-checking a consumer's file against core's built declarations may take: the compiler loads the
 * whole public surface, several seconds on a loaded machine - a bound for a hang, never a measure of speed.
 */
export const PACKAGING_TYPE_CHECK_TIMEOUT_MS = 120_000
