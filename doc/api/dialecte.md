---
description: API reference for the dialecte declaration - defineDialecte and what core derives from it (createProjectFactory, createTestHelpers).
---

# Dialecte declaration

A dialecte declares itself once with `defineDialecte`. Everything core builds for it - the project factory, the test runner, the test project and, in a worker, its engine - is derived from that one declaration. A dialecte package no longer wires a `Project` constructor by hand.

## defineDialecte

```ts
import { version } from '../../package.json'

import { defineDialecte } from '@dialecte/core'

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
import { createProjectFactory } from '@dialecte/core'

export const createSclProject = createProjectFactory({ dialecte: SCL_DIALECTE })

const project = await createSclProject({ extensions: myModules }).open('my-project')
```

The factory makes a `Project` with every config of the declaration, its default key, its extensions merged under the consumer's and a fresh hooks instance per project. Per call, a consumer chooses only what is its own:

| Param        | Type                 | Description                                             |
| ------------ | -------------------- | ------------------------------------------------------- |
| `storage`    | `StorageParam`       | Defaults to the local store.                            |
| `extensions` | `ExtensionModules`   | The consumer's own modules, merged over the dialecte's. |
| `dev`        | `{ perf?: boolean }` | Project dev options (see [Project](/api/project)).      |

The factory carries what it was made with, `createSclProject.dialecte`, and names no store and no engine: it is the same whatever storage a project opens on. `createSclProject.destroyProject({ name })` deletes the dialecte's project of that name on SQLite storage without opening it (see [SQLite storage](/api/project#sqlite-storage)). A project on `sqlite` storage reaches the engine the app registered: see [The engine worker and its packaging](#the-engine-worker-and-its-packaging).

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

A project on `sqlite` storage runs in an engine worker, and the app assembles it: one worker file for all its dialectes, and one call that tells the page where it is. Both come from one entry, `@dialecte/core/sqlite`. A dialecte ships nothing of this.

**The worker file.** One file in the app, one call, every dialecte the app opens on SQLite. Each engine runs its dialecte's configs and its own hooks instance (`createHooks()`). One file serves all the dialectes; each worker it starts serves one project.

```ts
// src/engine.worker.ts
import { serveSqliteEngine } from '@dialecte/core/sqlite'
import { NSD_DIALECTE } from '@dialecte/nsd'
import { SCL_DIALECTE } from '@dialecte/scl'

serveSqliteEngine({ dialectes: [SCL_DIALECTE, NSD_DIALECTE] })
```

A worker asked for a dialecte it was not given answers `PROJECT_DIALECTE_MISMATCH`, naming the ones it was given, and one of a given dialecte at another version `PROJECT_DIALECTE_VERSION_MISMATCH`; no file touched in either case.

**The page.** `registerSqliteEngine({ url, dialectes })`, synchronous, answers nothing. Call it once, before the first project opens: in the app's entry, or in the shell of an app made of several frames. The registration lives in the page (its realm): a frame of the same origin that joins the hub on its own registers too, or is bound by its page through `adoptHubPort`; a frame of another origin never registers - it joins through `adoptHubPort` first, and a project it opens before that is refused. `url` is a `?worker&url` import of the worker file. `dialectes` names every dialecte that file serves; the declarations fit, and only each id and version are kept, as plain data, so every copy of the library in the page finds them.

```ts
// src/main.ts
import engineUrl from './engine.worker?worker&url'

import { registerSqliteEngine } from '@dialecte/core/sqlite'
import { NSD_DIALECTE } from '@dialecte/nsd'
import { SCL_DIALECTE } from '@dialecte/scl'

registerSqliteEngine({ url: engineUrl, dialectes: [SCL_DIALECTE, NSD_DIALECTE] })
```

The page reads the registration when a project connects, so a project built before the call and opened after it works. A project whose dialecte it does not name, or any project with no call made, is refused `PROJECT_SQLITE_ENGINE_NOT_REGISTERED`, at `open` and at `destroyProject`, nothing started. A registration names a dialecte by id: a project of a registered dialecte at another version goes on and is refused `PROJECT_DIALECTE_VERSION_MISMATCH` by its engine or the hub.

**A second call.** There is no additive call: the app names all its dialectes once.

| A later `registerSqliteEngine`                              | What it does                                                                        |
| ----------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| The same URL and the same dialectes, in any order           | Nothing (a module evaluated twice).                                                 |
| Another URL, or other dialectes                             | Thrown `STORE_SQLITE_ENGINE_FIXED`, the first kept; `meta` `{ registered, asked }`. |
| Two versions of one dialecte in the call (a first call too) | Thrown `STORE_HUB_SPAWNERS_FIXED`, nothing of that call kept.                       |

**A child frame of another origin** does not register: its shell does. It joins through `adoptHubPort` before its first `open`, and is a client of the engines its shell starts ([below](#views-sharing-a-project-the-origin-s-hub)); its destroys are deleted by a view of the origin that can store.

**A dialecte package** ships its declaration only: no worker, no store named, nothing of SQLite. Its main entry exports the declaration (and the factory derived from it); its library build keeps `@dialecte/core` external and needs no worker setting.

**An app's build** needs nothing: no `optimizeDeps.exclude`, no `worker.format`, in the dev server and in a production build. The page holds no engine code: the engine and sqlite-wasm are reached through a lazy import inside `serveSqliteEngine`, which a page never calls, so they end up in the worker file only. The worker file also carries the entry's page side (its import registers the storage kind), a size cost the page does not pay. An app importing `@dialecte/core/sqlite` emits one content-hashed `sqlite3-*.wasm` for all its engines, and the hub's worker (`hub.worker-*.js`); an app that never imports it emits neither. It installs nothing beyond `@dialecte/core` and its dialectes: sqlite-wasm and comlink are core's dependencies.

**An app that works offline** (a PWA) adds three files to its precache list and nothing else: the hub's worker (`hub.worker-*.js`), the engine worker file (named after the app's file: `engine.worker.ts` gives `engine.worker-*.js`) and the wasm (`sqlite3-*.wasm`). That holds for the bundler's default worker format, which bundles the worker whole; an app that sets `worker.format: 'es'` gets a fourth file, the engine's own chunk (`sqlite-engine-*.js`), which its list must hold too (a worker that cannot load it answers every open `PROJECT_ENGINE_UNAVAILABLE`).

**A browser test of the app's worker** starts it from the same `?worker&url` import, never from a plain `new URL(file, import.meta.url)`: the test runner's browser mode wraps the worker's lazy import of the engine in a helper it gives only to the workers it knows from that import.

**Version check.** A view and the engine it reaches run the same dialecte version: a view of another version is refused `PROJECT_DIALECTE_VERSION_MISMATCH` (reload every tab after a deploy).

## Views sharing a project: the origin's hub

The origin's hub is a SharedWorker through which every tab, window and iframe of an app shares one engine per project on `sqlite` storage. It elects the view that hosts each project's engine worker, hands every other view a port to it, and elects another host when that view goes away. A page joins it and binds its children already, offering the engines the app registered, one per dialecte on the one worker file:

```ts
import { adoptHubPort, connectHub, registerSqliteEngine } from '@dialecte/core/sqlite'

// a page: joins the hub, offering the engines the app registered (their worker of its own origin)
registerSqliteEngine({ url: engineUrl, dialectes: [SCL_DIALECTE, NSD_DIALECTE] })
const realm = await connectHub()

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

- `connectHub()` answers the page's connection, the same one for every call and every copy of the library of the same protocol in the page; `undefined` where the browser has no SharedWorker or the hub never welcomed the page (its script failed to load, was blocked or stayed silent) - a later call tries again. It offers the engines the app registered (`registerSqliteEngine`); a worker file of another origin is left out: the page cannot start it. Connecting before registering is allowed and offers nothing: a later call adds those registered since, and so does a project opening on `sqlite`, which offers every registered dialecte as it opens (a page that never calls `connectHub` still hosts the engines of its own projects) - but register first. An engine the connection runs at another version is refused `STORE_HUB_SPAWNERS_FIXED`, nothing added, the connection kept: a page runs one version of each dialecte's engine. A document that joined through `adoptHubPort` hosts no engine and offers none. Neither does a page that cannot store (no private file system): it hosts no engine, its own projects on `sqlite` are refused `STORE_UNAVAILABLE` (unless its page bound it through `adoptHubPort`), and its connection serves to hand ports to its children (`createHubPort`). An engine's files (the SQLite wasm) are fetched when the page first starts one. Call it early in the page that hosts the app (the shell), after registering: a view of another origin is a client of the engines the shell starts. The browser refusing to make the hub's worker (a `DOMException`) is no hub; any other error thrown making it is thrown.
- `createHubPort()` makes a port bound to the page for a child view; `unbind()` on its handle tells the hub the child is gone (its iframe removed).
- `adoptHubPort({ port })`, in the child, joins the hub through that port. A port nobody answers fails it `STORE_CONNECTION_FAILED` once the welcome budget has passed.
- The hub's worker gone (the browser ended it), each view joins the next hub at once: a call waiting for an engine waits for that hub's - a read is made again there - and a write in flight is refused `STORE_ENGINE_LOST` as for any lost engine. A hub lost within a second of its welcome, or hubs that keep ending (past three at-once joins in a row), refuse the calls `STORE_CONNECTION_FAILED` until a later join, after a growing delay. A child bound through `adoptHubPort` (it cannot watch the hub) asks its hub whether it lives when its page hands it a new port, and joins on that port only when no answer comes.
- **Page lifecycle.** A page that freezes or enters the back/forward cache lets the engines it hosts go (another view hosts them) and joins again under a new realm id when it comes back; a page going away ends them. The children it bound are dropped with it: their calls are refused `STORE_ENGINE_LOST` (`meta.reason: 'realm-dropped'`) until the page binds them again. `realm.onRejoined(listener)` is called each time the page is welcomed back (never on its first welcome; it answers its unsubscribe): make each child a new port there, and the child calls `adoptHubPort` with it - the same connection joins again, its projects kept.

What a view's calls through the hub will answer, and what joining it answers already:

| Key                                 | When                                                                                                                                                                                                                                           |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PROJECT_ENGINE_UNAVAILABLE`        | No open view can start the project's engine worker (none registered an engine for its dialecte), or the engine never said it opened; a destroy still running past the open budget, or one asked by a page suspended before the hub granted it. |
| `PROJECT_ENGINE_BUSY`               | Another engine still holds the project (another tab, or a worker that did not stop).                                                                                                                                                           |
| `PROJECT_DIALECTE_MISMATCH`         | The project's file or engine is of another dialecte than the one asked: a worker file not given a dialecte the page registered, or a file another dialecte stored. Two dialectes' projects of one name are two projects.                       |
| `PROJECT_DIALECTE_VERSION_MISMATCH` | The project's engine runs another version of the dialecte than this view.                                                                                                                                                                      |
| `PROJECT_DESTROYED_WHILE_AWAY`      | A view came back to its project (a page back from a freeze, its engine started again) after another tab destroyed it: nothing is opened in its place.                                                                                          |
| `STORE_PROTOCOL_MISMATCH`           | Another version of the library holds the hub, or the engine speaks another wire: every view of an app must run the same build.                                                                                                                 |
| `STORE_HUB_SPAWNERS_FIXED`          | The engines the app registered name a dialecte the page's connection runs at another version, as `connectHub()` or a project opening on `sqlite` offers them: one version of each dialecte's engine per page.                                  |
| `STORE_REALM_ID_TAKEN`              | A view joined with an id another connected view already uses.                                                                                                                                                                                  |
| `STORE_REALM_UNKNOWN`               | A view spoke to the hub without having joined it, or after it left (a child whose page went before it said hello).                                                                                                                             |
| `STORE_ENGINE_LOST`                 | The engine was lost while the call waited: `host-gone`, `no-heartbeat`, or `realm-dropped` for a child dropped with its page - see the error.                                                                                                  |
