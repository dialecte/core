import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const HERE = fileURLToPath(new URL('.', import.meta.url))
export const CORE_ROOT = path.resolve(HERE, '../../../../../..')
export const OUT_DIR = path.join(CORE_ROOT, 'node_modules/.tmp/hub-failover')
export const MAIN_PORT = 5191
export const CHILD_PORT = 5192
export const MAIN_ORIGIN = `http://localhost:${MAIN_PORT}`
export const CHILD_ORIGIN = `http://localhost:${CHILD_PORT}`
export const RUNS = 3
/** The engine's worker as the built page names it: the one dedicated worker the hosting tab runs. */
export const ENGINE_WORKER_URL = /test-dialecte\.worker/
/** How long a tab's workers are looked for: a browser may tell of a new worker a little after the page's answer. */
export const WORKER_SEEN_MS = 2_000
/** How long a read may wait for the next engine before its run is kept as failed. */
export const READ_BUDGET_MS = 30_000
/**
 * Run under tsx, the functions handed to the pages are kept named through a `__name` helper the pages lack: each
 * page gets one that keeps the function as it is.
 */
export const KEEP_NAMES = 'globalThis.__name = function keepName(target) { return target }'
export const FIREFOX_EXECUTABLE =
	process.env.FAILOVER_FIREFOX ??
	'/Applications/Firefox Developer Edition.app/Contents/MacOS/firefox'
