/**
 * `@dialecte/core/engine` - the entry of a dialecte's engine worker, never imported by the page: a
 * dialecte package's worker file calls `serveDialecteEngine({ dialecte })`, and its bundle carries the
 * project engine whole (today SQLite on the origin's private file system, with sqlite-wasm and comlink;
 * the consumer's one wasm file is handed to it at open). The page reaches that engine through
 * `@dialecte/core`, which keeps the database out of the page's bundle.
 */
export { serveDialecteEngine } from './store/sqlite/runtime/serve-dialecte-engine'
