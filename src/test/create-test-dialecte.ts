import { TEST_CONFIG_KEY } from './constant'
import { openTestProject, resolveTestDialecte } from './test-dialecte-setup'

import { createStagedOperations } from '@/document'
import { createProgressReporter } from '@/document/progress'
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
import type { AnyDialecteConfig } from '@/types'

/**
 * Spin up a Project of the declared dialecte - every config, the default key, its extensions and
 * its own hooks instance; core's own test dialecte when none is given - with the source (and
 * optionally the target) imported under the default config. Returns project + pre-opened
 * documents. Caller owns lifecycle via project.destroy().
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

/**
 * Create a Context directly for testing FP query functions: on `store` when given, else on the
 * local store named `databaseName`, opened to discover its tables.
 */
export async function createTestContext<GenericConfig extends AnyDialecteConfig>(
	params: TestContextParams<GenericConfig>,
): Promise<Context<GenericConfig>> {
	const { dialecteConfig, documentId } = params
	const store =
		params.store === undefined
			? resolveStore({
					name: params.databaseName,
					storage: { type: 'local' },
					runtime: {
						configs: { [TEST_CONFIG_KEY]: dialecteConfig },
						defaultConfigKey: TEST_CONFIG_KEY,
					},
				})
			: params.store
	await store.open()
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
