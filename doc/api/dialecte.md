---
description: API reference for the dialecte declaration - defineDialecte and what core derives from it (createProjectFactory, createTestHelpers).
---

# Dialecte declaration

A dialecte declares itself once with `defineDialecte`. Everything core builds for it - the project factory, the test runner, the test project and, in a worker, its engine - is derived from that one declaration. A dialecte package no longer wires a `Project` constructor by hand.

## defineDialecte

```ts
import { defineDialecte } from '@dialecte/core'
import { version } from '../../package.json'

export const SCL_DIALECTE = defineDialecte({
	id: 'scl/v2019C1',
	version,
	configs: { scl: SCL_DIALECTE_CONFIG },
	defaultConfigKey: 'scl',
	extensions: SCL_EXTENSION_MODULES,
	createHooks: () => ({ ...createSclIoHooks(), ...HOOKS }),
})
```

**`DefineDialecteParams`**

| Param              | Type                                | Description                                                                                                                                                             |
| ------------------ | ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`               | `string`                            | The dialecte's identity: the engine stores it with each project it opens, so a project opens with the dialecte it was made with.                                        |
| `version`          | `string`                            | The dialecte package's version: a client and the engine it talks to must run the same one.                                                                              |
| `configs`          | `Record<string, AnyDialecteConfig>` | Every config of the dialecte, under the keys `configKey` names them by. A dialecte with two document kinds (nsd: `nsd` and `nsdoc`) declares both.                      |
| `defaultConfigKey` | key of `configs`                    | The config a document gets when it names none. Must be one of `configs`: otherwise `UNKNOWN_CONFIG_KEY` (D7001) is thrown at declaration time.                          |
| `extensions`       | `ExtensionModules` (optional)       | The dialecte's own extension modules, merged under the ones a consumer adds per project (see [Writing Extensions](/guide/extensions/)). Defaults to none.               |
| `createHooks`      | `() => DialecteHooks` (optional)    | Makes the dialecte's hooks, IO and transaction. Called once per Project and once per engine, so the state a hook keeps belongs to that one owner. Defaults to no hooks. |

**Returns** a frozen `DialecteDeclaration`: the same fields, `extensions` and `createHooks` always present.

::: tip Hooks are a factory
Hooks keep state (an import session's bookkeeping, a counter). A factory gives every Project and every engine its own instance: nothing is shared across realms, nothing needs a reset between projects.
:::

## What core derives

### createProjectFactory

```ts
import engineUrl from './engine.worker?worker&url'
import { createProjectFactory } from '@dialecte/core'

export const createSclProject = createProjectFactory({ dialecte: SCL_DIALECTE, engineUrl })

const project = await createSclProject({ extensions: myModules }).open('my-project')
```

The factory makes a `Project` with every config of the declaration, its default key, its extensions merged under the consumer's and a fresh hooks instance per project. Per call, a consumer chooses only what is its own:

| Param        | Type                 | Description                                             |
| ------------ | -------------------- | ------------------------------------------------------- |
| `storage`    | `StorageParam`       | Defaults to the local store.                            |
| `extensions` | `ExtensionModules`   | The consumer's own modules, merged over the dialecte's. |
| `dev`        | `{ perf?: boolean }` | Project dev options (see [Project](/api/project)).      |

The factory carries what it was made with: `createSclProject.dialecte` and `createSclProject.engineUrl`, and `createSclProject.spawner`, the dialecte's engine as a page offers it to the hub (`connectHub`, below). `createSclProject.destroyProject({ name })` deletes the dialecte's project of that name on SQLite storage without opening it (see [SQLite storage](/api/project#sqlite-storage)). `engineUrl` is the address of the dialecte's engine worker, the URL the dialecte's module exports from a `?worker&url` import of its worker entry; a project on `sqlite` storage starts `new Worker(engineUrl, { type: 'module' })` on it. See [The engine worker and its packaging](#the-engine-worker-and-its-packaging).

### createTestHelpers

`createTestHelpers({ dialecte, storage?, schemaName?, extraChecks? })` in `@dialecte/core/test` returns every test helper of the dialecte: the runner, the test project, the record factory, the XPath assertions and the schema assertions (the last three bound to the default config). Each test project is built the way the factory builds a project: every config, the default key, the dialecte's extensions and its own hooks instance. A runner call and a test project take a `configKey`: the fixtures are imported under that config and checked against its schema (the default config when no key is given; an unknown key is refused with `UNKNOWN_CONFIG_KEY`; a runner call's own `dialecteConfig` replaces the config under that key). `storage` names the store the test projects run on (the local store by default, `{ type: 'inMemory' }` on request; a test project's own `storage` wins). `schemaName` names the schema in fixture violation messages (the dialecte's `id` by default).

```ts
import { createTestHelpers } from '@dialecte/core/test'

export const {
	runTestCases: runMyTestCases,
	createTestProject: createMyTestProject,
	createTestRecord: createMyTestRecord,
	assertExpectedElementQueries,
	assertUnexpectedElementQueries,
	assertValidXml: assertValidMyXml,
} = createTestHelpers({ dialecte: MY_DIALECTE, schemaName: 'MyDialecte' })
```

A check a dialecte adds of its own (scl's coherent references) goes in `extraChecks`: `testCases({ testCases, configKey })` on a runner call's cases and `fixture({ xml, label, configKey })` on a test project's source then target, each run only once the schema check has passed. A test project skips them with `skipExtraChecks: '<why>'`; the schema check still runs.

```ts
createTestHelpers({
	dialecte: SCL_DIALECTE,
	schemaName: 'SCL',
	extraChecks: {
		testCases: ({ testCases }) => assertCoherentSclReferencesTestCases({ testCases }),
		fixture: ({ xml, label }) => assertCoherentSclReferences({ xml, label }),
	},
})
```

The builders it is made of take the declaration too: `createTestRunner({ dialecte, storage? })` and `createTestProject({ dialecte?, sourceXml, ... })`, without the fixture check. `createTestProject` without a `dialecte` builds core's own test dialecte (`TEST_DIALECTE`, its one config under the key `default`). Passing `dialecteConfig`, `extensions` and `hooks` one by one still works and is deprecated: the one config goes under the key `default` and one hooks instance is shared across every project. See [Testing](/guide/development/testing).

## The engine worker and its packaging

A project on `sqlite` storage runs in the dialecte's engine worker. A dialecte package ships that worker; an app only bundles it.

**The worker entry.** One call, in a file of the dialecte package. Core's `@dialecte/core/engine` entry serves the engine, with the dialecte's configs and its own hooks instance (`createHooks()`):

```ts
// src/v2019C1/engine.worker.ts
import { serveDialecteEngine } from '@dialecte/core/engine'
import { SCL_DIALECTE } from './dialecte'

serveDialecteEngine({ dialecte: SCL_DIALECTE })
```

**The engine URL.** The module that builds the project factory imports the worker entry as a URL and hands it to `createProjectFactory` (core starts it with `new Worker(engineUrl, { type: 'module' })`). Put that module behind a sub-path of its own: a dialecte whose main entry imports the worker makes every app that imports the dialecte emit the worker, SQLite engine inside, used or not.

```ts
import engineUrl from './engine.worker?worker&url'
import { createProjectFactory } from '@dialecte/core'

export const createSclProject = createProjectFactory({ dialecte: SCL_DIALECTE, engineUrl })
```

**A dialecte's library build** (Vite): `base: './'` (the default base writes absolute `/assets/` URLs, which break once the package is installed elsewhere), `worker: { format: 'es' }`, and `@dialecte/core` external. The worker chunk holds no wasm: every engine is handed the app's one SQLite wasm file at open.

```ts
export default defineConfig({
	base: './',
	worker: { format: 'es' },
	build: {
		lib: { entry: { index: 'src/index.ts' }, formats: ['es'] },
		rollupOptions: { external: [/^@dialecte\/core/] },
	},
})
```

**An app's build** needs nothing: no `optimizeDeps.exclude`, no `worker.format` (dev server and production build both checked with core's built package and with a packed tarball). Once the app imports `@dialecte/core/sqlite` it emits one content-hashed `sqlite3-*.wasm` for every dialecte engine and the hub's worker (`hub.worker-*.js`); an app that never imports it emits neither. Each dialecte's engine worker is emitted when the app imports the module that names it. An app that works offline (a PWA) adds those to its precache list - the hub chunk (`hub.worker-*.js`), each engine chunk (named after the dialecte's worker entry file: `engine.worker.ts` gives `engine.worker-*.js`) and the wasm (`sqlite3-*.wasm`) - and nothing else. The app installs nothing beyond `@dialecte/core` and its dialectes: sqlite-wasm and comlink are core's dependencies.

**Version check.** A view and the engine it reaches run the same dialecte version: the engine runs the copy of the view that started it, and a view of another version is refused `PROJECT_DIALECTE_VERSION_MISMATCH` (reload every tab after a deploy).

## Views sharing a project: the origin's hub

The origin's hub is a SharedWorker through which every tab, window and iframe of an app shares one engine per project on `sqlite` storage. It elects the view that hosts each project's engine worker, hands every other view a port to it, and elects another host when that view goes away. A page joins it and binds its children already, offering each dialecte's engine through its project factory's `spawner` (the dialecte's id, its version and its engine worker's URL):

```ts
import { adoptHubPort, connectHub } from '@dialecte/core/sqlite'

// a page: joins the hub, offering the engines it can start (their worker of its own origin)
const realm = await connectHub({ spawners: [scl.spawner, nsd.spawner] })

// an iframe that cannot reach the hub's script (another origin, a sandbox): its page makes it a port and hands it
// over - the message is the app's own
if (realm) {
	const handle = realm.createHubPort()
	frame.contentWindow?.postMessage({ type: 'hub-port', port: handle.port }, childOrigin, [
		handle.port,
	])
}

// in the iframe: the port its page handed it
window.addEventListener('message', async function joinThroughPage(event) {
	if (event.origin !== pageOrigin || event.data?.type !== 'hub-port') return
	const childRealm = await adoptHubPort({ port: event.data.port })
})
```

- `connectHub({ spawners? })` answers the page's connection, the same one for every call and every copy of the library of the same protocol in the page; `undefined` where the browser has no SharedWorker or the hub never welcomed the page (its script failed to load, was blocked or stayed silent) - a later call tries again. A spawner whose engine worker is of another origin is left out: the page cannot start it. A later call adds the engines the page does not run yet (a project opened on `sqlite` adds its own as it opens: a page that never calls `connectHub` still hosts the engines of its own projects); one naming a dialecte the page runs at another version is refused `STORE_HUB_SPAWNERS_FIXED`, nothing of it added, the connection kept - a page runs one version of each dialecte's engine. A document that joined through `adoptHubPort` hosts no engine: the spawners it names are not registered. Neither are those of a page that cannot store (no private file system) - checked all the same, two versions of one dialecte refused: such a page hosts no engine, its own projects on `sqlite` are refused `STORE_UNAVAILABLE` (unless its page bound it through `adoptHubPort`), and its connection serves to hand ports to its children (`createHubPort`). An engine's files (the SQLite wasm) are fetched when the page first starts one. Call it early in the page that hosts the app (the shell), with every dialecte it opens: a view of another origin is a client of the engines the shell starts. The browser refusing to make the hub's worker (a `DOMException`) is no hub; any other error thrown making it is thrown.
- `createHubPort()` makes a port bound to the page for a child view; `unbind()` on its handle tells the hub the child is gone (its iframe removed).
- `adoptHubPort({ port })`, in the child, joins the hub through that port. A port nobody answers fails it `STORE_CONNECTION_FAILED` once the welcome budget has passed.
- The hub's worker gone (the browser ended it), each view joins the next hub at once: a call waiting for an engine waits for that hub's - a read is made again there - and a write in flight is refused `STORE_ENGINE_LOST` as for any lost engine. A hub lost within a second of its welcome, or hubs that keep ending (past three at-once joins in a row), refuse the calls `STORE_CONNECTION_FAILED` until a later join, after a growing delay. A child bound through `adoptHubPort` (it cannot watch the hub) asks its hub whether it lives when its page hands it a new port, and joins on that port only when no answer comes.
- **Page lifecycle.** A page that freezes or enters the back/forward cache lets the engines it hosts go (another view hosts them) and joins again under a new realm id when it comes back; a page going away ends them. The children it bound are dropped with it: their calls are refused `STORE_ENGINE_LOST` (`meta.reason: 'realm-dropped'`) until the page binds them again. `realm.onRejoined(listener)` is called each time the page is welcomed back (never on its first welcome; it answers its unsubscribe): make each child a new port there, and the child calls `adoptHubPort` with it - the same connection joins again, its projects kept.

What a view's calls through the hub will answer, and what joining it answers already:

| Key                                 | When                                                                                                                                                                                                                                        |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PROJECT_ENGINE_UNAVAILABLE`        | No open view can start the project's engine worker (none offered a spawner for its dialecte), or the engine never said it opened; a destroy still running past the open budget, or one asked by a page suspended before the hub granted it. |
| `PROJECT_ENGINE_BUSY`               | Another engine still holds the project (another tab, or a worker that did not stop).                                                                                                                                                        |
| `PROJECT_DIALECTE_MISMATCH`         | The project's file or engine is of another dialecte than the one asked: an `engineUrl` pointing at another dialecte's worker, or a file another dialecte stored. Two dialectes' projects of one name are two projects.                      |
| `PROJECT_DIALECTE_VERSION_MISMATCH` | The project's engine runs another version of the dialecte than this view.                                                                                                                                                                   |
| `PROJECT_DESTROYED_WHILE_AWAY`      | A view came back to its project (a page back from a freeze, its engine started again) after another tab destroyed it: nothing is opened in its place.                                                                                       |
| `STORE_PROTOCOL_MISMATCH`           | Another version of the library holds the hub, or the engine speaks another wire: every view of an app must run the same build.                                                                                                              |
| `STORE_HUB_SPAWNERS_FIXED`          | `connectHub({ spawners })` named a dialecte the page's connection runs at another version, or a project on `sqlite` was opened or destroyed from a factory of such a version: one version of each dialecte's engine per page.               |
| `STORE_REALM_ID_TAKEN`              | A view joined with an id another connected view already uses.                                                                                                                                                                               |
| `STORE_REALM_UNKNOWN`               | A view spoke to the hub without having joined it, or after it left (a child whose page went before it said hello).                                                                                                                          |
| `STORE_ENGINE_LOST`                 | The engine was lost while the call waited: `host-gone`, `no-heartbeat`, or `realm-dropped` for a child dropped with its page - see the error.                                                                                               |
