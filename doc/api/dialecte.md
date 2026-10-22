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
