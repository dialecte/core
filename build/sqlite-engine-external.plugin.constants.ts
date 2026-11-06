import { fileURLToPath, URL } from 'node:url'

/** The file whose dynamic import reaches the engine's chunk. */
export const SQLITE_ENTRY = fileURLToPath(new URL('../src/sqlite.ts', import.meta.url))

/** That import, as `SQLITE_ENTRY` writes it. */
export const SQLITE_ENGINE_IMPORT = './sqlite-engine'

/** That import in the built entry: the engine build writes its chunk beside it. */
export const SQLITE_ENGINE_CHUNK = './sqlite-engine.js'
