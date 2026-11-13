/**
 * The least time between two counted reports of one phase or step of a file's import (`processing`, `checking`,
 * `applying`): a report within it waits, the last of a step and a phase or step that begins are told at once.
 */
export const IMPORT_PROGRESS_INTERVAL_MS = 50

/** The session's diagnostics and writes checked per chunk of this many, `checking` told after each. */
export const IMPORT_CHECK_CHUNK_SIZE = 1000

/** The step core tells once, before the dialecte's `afterImport` runs. */
export const IMPORT_PROCESSING_START_STEP = 'start'
