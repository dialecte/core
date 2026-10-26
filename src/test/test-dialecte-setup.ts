import { TEST_DIALECTE_CONFIG } from './config'
import { TEST_CONFIG_KEY } from './constant'
import { TEST_DIALECTE } from './test-dialecte'

import { onTestFinished } from 'vitest'

import { defineDialecte } from '@/dialecte'
import { createDialecteProject } from '@/dialecte/create-dialecte-project'
import { createDialecteError } from '@/errors'

import type {
	DeclaredTestDialecteParams,
	LegacyTestDialecteParams,
	TestDocument,
	TestProjectOptions,
	TestProjectResult,
} from './create-test-dialecte.types'
import type { ResolveTestConfigParams, TestDialecteSetup } from './test-dialecte-setup.types'
import type { ExtensionModules } from '@/document'
import type { Project } from '@/project'
import type { AnyDialecteConfig, DialecteHooks } from '@/types'

/** The setup behind either form: the declaration given, core's own, or one made from the parts. */
export function resolveTestDialecte<GenericConfig extends AnyDialecteConfig>(
	params:
		| Partial<DeclaredTestDialecteParams<GenericConfig, ExtensionModules, string>>
		| LegacyTestDialecteParams<GenericConfig>,
): TestDialecteSetup<GenericConfig> {
	if (params.dialecte) return { dialecte: params.dialecte }

	const { dialecteConfig, extensions, hooks } = params as LegacyTestDialecteParams<GenericConfig>
	if (!dialecteConfig && !extensions && !hooks) {
		// a caller may name GenericConfig and still take core's own test dialecte
		return { dialecte: TEST_DIALECTE as unknown as TestDialecteSetup<GenericConfig>['dialecte'] }
	}
	function sharedHooks(): DialecteHooks<GenericConfig> {
		return hooks ?? {}
	}
	const dialecte = defineDialecte<GenericConfig, ExtensionModules, string>({
		id: TEST_DIALECTE.id,
		version: TEST_DIALECTE.version,
		configs: {
			[TEST_CONFIG_KEY]: dialecteConfig ?? (TEST_DIALECTE_CONFIG as unknown as GenericConfig),
		},
		defaultConfigKey: TEST_CONFIG_KEY,
		extensions: extensions?.base,
		createHooks: sharedHooks,
	})
	return { dialecte, custom: extensions?.custom }
}

/**
 * The declared config under `configKey` (the default config when no key is given). An unknown key
 * is refused with `UNKNOWN_CONFIG_KEY` before any store is touched.
 */
export function resolveTestConfig<GenericConfig extends AnyDialecteConfig>(
	params: ResolveTestConfigParams<GenericConfig>,
): { configKey: string; config: GenericConfig } {
	const { dialecte } = params.setup
	const configKey = params.configKey ?? dialecte.defaultConfigKey
	if (!Object.hasOwn(dialecte.configs, configKey)) {
		throw createDialecteError('UNKNOWN_CONFIG_KEY', {
			detail: `The test dialecte "${dialecte.id}" has no config "${configKey}": ${Object.keys(dialecte.configs).join(', ')}.`,
			meta: { id: dialecte.id, configKey, configKeys: Object.keys(dialecte.configs) },
		})
	}
	return { configKey, config: dialecte.configs[configKey] }
}

/** The setup with a case's own config (under `configKey`, else the default key) or hooks. */
export function overrideTestDialecte<GenericConfig extends AnyDialecteConfig>(params: {
	setup: TestDialecteSetup<GenericConfig>
	configKey?: string
	dialecteConfig?: GenericConfig
	hooks?: DialecteHooks<GenericConfig>
}): TestDialecteSetup<GenericConfig> {
	const { setup, dialecteConfig, hooks } = params
	const { configKey } = resolveTestConfig({ setup, configKey: params.configKey })
	if (!dialecteConfig && !hooks) return setup
	const { dialecte } = setup
	function caseHooks(): DialecteHooks<GenericConfig> {
		return hooks ?? dialecte.createHooks()
	}
	return {
		...setup,
		dialecte: defineDialecte<GenericConfig, ExtensionModules, string>({
			...dialecte,
			configs: dialecteConfig
				? { ...dialecte.configs, [configKey]: dialecteConfig }
				: dialecte.configs,
			createHooks: caseHooks,
		}),
	}
}

/**
 * Open a test project on the setup, with the source (and the target, when given) imported under
 * the default config. Opened inside a running test (its body or a `beforeEach`), the project is
 * destroyed when that test ends; opened outside one (`beforeAll`, module scope), the caller owns
 * its lifecycle: `project.destroy()`. A destroy by the caller as well is harmless.
 */
export async function openTestProject<
	GenericConfig extends AnyDialecteConfig,
	GenericModules extends ExtensionModules = Record<never, never>,
>(
	params: TestProjectOptions & { setup: TestDialecteSetup<GenericConfig> },
): Promise<TestProjectResult<GenericConfig, GenericModules>> {
	const { setup, sourceXml, targetXml, storage, dev } = params
	const { dialecte, custom } = setup
	const { configKey } = resolveTestConfig({ setup, configKey: params.configKey })

	// The module types are the overloads' promise; the harness wires the declaration's erased ones.
	const project = (await createDialecteProject({ dialecte, storage, extensions: custom, dev }).open(
		`test-${crypto.randomUUID()}`,
	)) as unknown as Project<GenericConfig, GenericModules>
	destroyWhenTestEnds({ project })

	const source = await importTestDocument({
		project,
		xml: sourceXml,
		fileName: 'source.xml',
		configKey,
	})
	const target = targetXml
		? await importTestDocument({ project, xml: targetXml, fileName: 'target.xml', configKey })
		: undefined

	return { project, source, target }
}

async function importTestDocument<
	GenericConfig extends AnyDialecteConfig,
	GenericModules extends ExtensionModules,
>(params: {
	project: Project<GenericConfig, GenericModules>
	xml: string
	fileName: string
	configKey: string
}): Promise<TestDocument<GenericConfig, GenericModules>> {
	const { project, xml, fileName, configKey } = params
	const { documentId } = await project.importFile(new File([xml], fileName, { type: 'text/xml' }), {
		configKey,
		useCustomRecordsIds: true,
	})
	return { documentId, document: project.openDocument(documentId) }
}

/**
 * Destroy the project when the running test ends, so a test that forgets it leaves no store behind.
 * Outside a running test vitest refuses the hook (it throws): the caller then owns the teardown.
 */
function destroyWhenTestEnds(params: { project: { destroy: () => Promise<void> } }): void {
	const { project } = params
	try {
		onTestFinished(() => project.destroy())
	} catch {
		// not inside a running test
	}
}
