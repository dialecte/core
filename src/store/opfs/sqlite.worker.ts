import { SqliteEngine } from './sqlite-engine'

import * as Comlink from 'comlink'

// The SQL engine runs here, in the worker, where OPFS `opfs-sahpool` gets its
// synchronous access handles. Comlink proxies the class constructor + methods so
// the main-thread SqliteStore can `new`/call it over postMessage.
Comlink.expose(SqliteEngine)
