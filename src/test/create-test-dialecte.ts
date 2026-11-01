import { TEST_CONFIG_KEY } from './constant'
import { openTestProject, resolveTestDialecte } from './test-dialecte-setup'
import { resolveTestStorage, testStoreFor } from './test-storage'

import { createStagedOperations } from '@/document'
import { createProgressReporter } from '@/document/progress'
import { createDialecteError } from '@/errors'
import { NOOP_PERF } from '@/perf'
import { resolveStore } from '@/store/resolve-store'

import type { TestDialecteConfig } from './config'
import type {
	DeclaredTestProjectParams,
	LegacyTestProjectParams,
	TestContextParams,
	TestProjectResult,
} from './create-test-dialecte.types'
import type { Context, ExtensionModules } from '@/document'
import type { StorageParam } from '@/project'
import type { Store } from '@/store/store.types'
import type { AnyDialecteConfig } from '@/types'

/**
 * Spin up a Project of the declared dialecte - every config, the default key, its extensions and
 * its own hooks instance; core's own test dialecte when none is given - with the source (and
 * optionally the target) imported under the default config. Returns project + pre-opened
 * documents. Opened inside a running test, the project is destroyed when the test ends (after its other
 * `onTestFinished` hooks); opened outside one (`beforeAll`), the caller destroys it.
 */
export async function createTestProject<
	GenericConfig extends AnyDialecteConfig = TestDialecteConfig,
	GenericModules extends ExtensionModules = Record<never, never>,
	GenericConfigKey extends string = string,
>(
	params: DeclaredTestProjectParams<GenericConfig, GenericModules, GenericConfigKey>,
): Promise<TestProjectResult<GenericConfig, GenericModules>>
/**
 * Spin up a Project from a config, extensions and hooks given one by one, with the source (and
 * optionally the target) imported under the key `default`.
 * @deprecated Declare the dialecte with `defineDialecte` and pass it as `dialecte`.
 */
export async function createTestProject<
	GenericConfig extends AnyDialecteConfig = TestDialecteConfig,
	GenericModules extends ExtensionModules = Record<never, never>,
>(
	params: LegacyTestProjectParams<GenericConfig>,
): Promise<TestProjectResult<GenericConfig, GenericModules>>
export async function createTestProject(
	params:
		| DeclaredTestProjectParams<AnyDialecteConfig, ExtensionModules, string>
		| LegacyTestProjectParams<AnyDialecteConfig>,
): Promise<TestProjectResult<AnyDialecteConfig, ExtensionModules>> {
	const { sourceXml, targetXml, configKey, storage, dev } = params
	return openTestProject({
		setup: resolveTestDialecte(params),
		sourceXml,
		targetXml,
		configKey,
		storage,
		dev,
	})
}

/** The stores `createTestContext` opened by name: connections of their own, closed by `closeTestContexts`. */
const OPENED_CONTEXT_STORES = new Set<Store>()

/**
 * Create a Context directly for testing FP query functions: on `store` when given, else on the store
 * of the project named `databaseName` - of the kind `storage` names, else the test helpers' default
 * (`useTestStorage`), else the local store - opened to discover its tables. Opened by name, it is a
 * connection of its own: the project cannot be destroyed while it is open - `closeTestContexts()` first.
 */
export async function createTestContext<GenericConfig extends AnyDialecteConfig>(
	params: TestContextParams<GenericConfig>,
): Promise<Context<GenericConfig>> {
	const { dialecteConfig, documentId } = params
	const store = params.store ?? (await storeByName({ ...params, dialecteConfig }))
	await store.open()
	if (params.store === undefined) OPENED_CONTEXT_STORES.add(store)
	return {
		dialecteConfig,
		store,
		documentId,
		recordCache: new Map(),
		stagedOperations: createStagedOperations(),
		progress: createProgressReporter({
			loading: false,
			error: null,
			progress: null,
			history: [],
			lastUpdate: null,
		}),
		perf: NOOP_PERF,
	}
}

/**
 * The store of the project named, of the kind `storage` names (else the test helpers' default): on `sqlite`, the
 * SQLite engine in this realm, which needs the project's dialecte.
 */
async function storeByName<GenericConfig extends AnyDialecteConfig>(params: {
	databaseName: string
	dialecteId: string | undefined
	storage?: StorageParam
	dialecteConfig: GenericConfig
}): Promise<Store> {
	const { databaseName, dialecteId, dialecteConfig } = params
	const runtime = {
		configs: { [TEST_CONFIG_KEY]: dialecteConfig },
		defaultConfigKey: TEST_CONFIG_KEY,
	}
	const kind = resolveTestStorage({ storage: params.storage })
	if (kind.type !== 'sqlite')
		return resolveStore({ name: databaseName, dialecteId, storage: kind, runtime })
	if (dialecteId === undefined) {
		throw createDialecteError('ASSERTION_FAILED', {
			detail: `A test context on SQLite names its project's dialecte: "${databaseName}" has none`,
			meta: { databaseName },
		})
	}
	// a context reads: its engine, when it starts one, imports with no dialecte hooks
	const storage = await testStoreFor({
		storage: kind,
		name: databaseName,
		dialecte: { id: dialecteId, ...runtime },
	})
	return resolveStore({ name: databaseName, dialecteId, storage, runtime })
}

/** Close every store `createTestContext` opened by name, so the projects they read can be destroyed: settled once they count no more. */
export async function closeTestContexts(): Promise<void> {
	const stores = [...OPENED_CONTEXT_STORES]
	OPENED_CONTEXT_STORES.clear()
	await Promise.all(stores.map(closeStore))
}

function closeStore(store: Store): Promise<void> {
	return store.close()
}
