import { createXmlSchemaAssertions } from './assert-valid-xml'
import { createXmlAssertions } from './assert-xml'
import { createTestRunner } from './run-test-cases'
import { openTestProject, resolveTestConfig } from './test-dialecte-setup'
import { createTestRecordFactory } from './test-record'

import type { TestProjectResult } from './create-test-dialecte.types'
import type {
	CheckTestCasesParams,
	CreateSchemaAssertionsParams,
	SchemaAssertionsForParams,
} from './create-test-helpers-internal.types'
import type {
	CreateTestHelpersParams,
	TestHelperProjectParams,
	TestHelpers,
	XmlSchemaAssertions,
} from './create-test-helpers.types'
import type { TestRunner } from './run-test-cases.type'
import type { ExtensionModules } from '@/document'
import type { AnyDialecteConfig } from '@/types'

function createSchemaAssertions(params: CreateSchemaAssertionsParams): XmlSchemaAssertions {
	const { config, schemaName } = params
	return createXmlSchemaAssertions({
		definition: config.definition,
		types: config.types,
		namespaces: config.namespaces,
		schemaName,
	})
}

/**
 * Every test helper a dialecte needs, derived from its declaration: the runner, the test project,
 * the record factory, the XPath assertions and the schema assertions. A fixture is checked against
 * the schema of the config it is imported under, then by the dialecte's extra checks, before a
 * case or a test project uses it.
 */
export function createTestHelpers<
	GenericConfig extends AnyDialecteConfig,
	GenericModules extends ExtensionModules = Record<never, never>,
	GenericConfigKey extends string = string,
>(
	params: CreateTestHelpersParams<GenericConfig, GenericModules, GenericConfigKey>,
): TestHelpers<GenericConfig, GenericModules> {
	const { dialecte, storage, schemaName = dialecte.id, extraChecks } = params
	const setup = { dialecte }
	const config = dialecte.configs[dialecte.defaultConfigKey]
	const schemaAssertionsByKey = new Map<string, XmlSchemaAssertions>()

	/** The schema assertions of the config under `configKey`, or of a case's own config. */
	function schemaAssertionsFor(request: SchemaAssertionsForParams<GenericConfig>): {
		configKey: string
		assertions: XmlSchemaAssertions
	} {
		const resolved = resolveTestConfig({ setup, configKey: request.configKey })
		if (request.caseConfig) {
			const assertions = createSchemaAssertions({ config: request.caseConfig, schemaName })
			return { configKey: resolved.configKey, assertions }
		}
		const cached = schemaAssertionsByKey.get(resolved.configKey)
		if (cached) return { configKey: resolved.configKey, assertions: cached }
		const assertions = createSchemaAssertions({ config: resolved.config, schemaName })
		schemaAssertionsByKey.set(resolved.configKey, assertions)
		return { configKey: resolved.configKey, assertions }
	}

	function checkTestCases(caseParams: CheckTestCasesParams<GenericConfig>): void {
		const { testCases } = caseParams
		const { configKey, assertions } = schemaAssertionsFor({
			configKey: caseParams.configKey,
			caseConfig: caseParams.dialecteConfig,
		})
		assertions.assertValidXmlTestCases({ testCases })
		extraChecks?.testCases?.({ testCases, configKey })
	}

	const runner = createTestRunner<GenericConfig, GenericModules, GenericConfigKey>({
		dialecte,
		storage,
	})
	const runTestCases: TestRunner<GenericConfig, GenericModules> = {
		...runner,
		withExport(caseParams) {
			checkTestCases(caseParams)
			runner.withExport(caseParams)
		},
		withoutExport(caseParams) {
			checkTestCases(caseParams)
			runner.withoutExport(caseParams)
		},
	}

	async function createTestProject(
		projectParams: TestHelperProjectParams,
	): Promise<TestProjectResult<GenericConfig, GenericModules>> {
		const { sourceXml, targetXml, dev, skipExtraChecks } = projectParams
		const { configKey, assertions } = schemaAssertionsFor({ configKey: projectParams.configKey })
		const fixtures = [
			{ xml: sourceXml, label: 'sourceXml' as const },
			...(targetXml ? [{ xml: targetXml, label: 'targetXml' as const }] : []),
		]
		// a fixture may leave out required attributes; its structure must still be the schema's
		for (const { xml, label } of fixtures) {
			assertions.assertValidXml({ xml, label, requireComplete: false })
		}
		if (!skipExtraChecks) {
			for (const { xml, label } of fixtures) extraChecks?.fixture?.({ xml, label, configKey })
		}
		return openTestProject<GenericConfig, GenericModules>({
			setup,
			sourceXml,
			targetXml,
			configKey,
			storage: projectParams.storage ?? storage,
			dev,
		})
	}

	return {
		runTestCases,
		createTestProject,
		createTestRecord: createTestRecordFactory(config),
		...createXmlAssertions({ namespaces: config.namespaces }),
		...schemaAssertionsFor({ configKey: undefined }).assertions,
	}
}
