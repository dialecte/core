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
import engineUrl from './worker?worker&url'
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

The factory carries what it was made with: `createSclProject.dialecte` and `createSclProject.engineUrl`. `engineUrl` is the address of the dialecte's engine worker, the URL the dialecte's module exports from a `?worker&url` import of its worker entry (`./<version>/worker` in the package); the store that runs the engine spawns `new Worker(engineUrl, { type: 'module' })` on it and ships in the same release. The worker entry and its assets are described with the engine.

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

## Views sharing a project: the origin's hub

The origin's hub is a SharedWorker through which every tab, window and iframe of an app will share one engine per project, once the engine is a storage option of `Project` - no store reaches it yet. It elects the view that hosts each project's engine worker, hands every other view a port to it, and elects another host when that view goes away. A page joins it and binds its children already:

```ts
import { adoptHubPort, connectHub } from '@dialecte/core'

// a page: joins the hub once, offering the engines it can start (their worker of its own origin)
const realm = await connectHub({ spawners })

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

- `connectHub({ spawners? })` answers the page's connection, the same one for every call and every copy of the library of the same protocol in the page; `undefined` where the browser has no SharedWorker or the hub never welcomed the page (its script failed to load, was blocked or stayed silent) - a later call tries again. A spawner whose engine worker is of another origin is left out: the page cannot start it.
- `createHubPort()` makes a port bound to the page for a child view; `unbind()` on its handle tells the hub the child is gone (its iframe removed).
- `adoptHubPort({ port })`, in the child, joins the hub through that port. A port nobody answers fails it `STORE_CONNECTION_FAILED` once the welcome budget has passed.
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
| `STORE_REALM_ID_TAKEN`              | A view joined with an id another connected view already uses.                                                                                                                                                                               |
| `STORE_REALM_UNKNOWN`               | A view spoke to the hub without having joined it, or after it left (a child whose page went before it said hello).                                                                                                                          |
| `STORE_ENGINE_LOST`                 | The engine was lost while the call waited: `host-gone`, `no-heartbeat`, or `realm-dropped` for a child dropped with its page - see the error.                                                                                               |
