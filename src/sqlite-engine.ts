/**
 * The engine's chunk, an internal build output no consumer names: `serveSqliteEngine` reaches it by a dynamic import,
 * which keeps the page's bundle free of it. It carries the project engine whole (today SQLite on the origin's private
 * file system, with sqlite-wasm and comlink; the consumer's one wasm file is handed to it at open).
 */
export { createSqliteEngineControl } from './store/sqlite/runtime/serve-sqlite-engine'
