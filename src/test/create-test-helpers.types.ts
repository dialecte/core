import type { createXmlSchemaAssertions } from './assert-valid-xml'
import type { createXmlAssertions } from './assert-xml'
import type {
	DeclaredTestRunnerParams,
	TestProjectOptions,
	TestProjectResult,
} from './create-test-dialecte.types'
import type { BaseXmlTestCase, TestCases, TestRunner } from './run-test-cases.type'
import type { createTestRecordFactory } from './test-record'
import type { ExtensionModules } from '@/document'
import type { AnyDialecteConfig } from '@/types'

export type XmlAssertions = ReturnType<typeof createXmlAssertions>
export type XmlSchemaAssertions = ReturnType<typeof createXmlSchemaAssertions>

/**
 * A dialecte's own fixture checks, run once core's schema check has passed (scl's coherent
 * references). Each throws to refuse.
 */
export type TestHelperExtraChecks = {
	/** On a runner call's cases, before the suite runs. */
	testCases?: (params: { testCases: TestCases<BaseXmlTestCase>; configKey: string }) => void
	/** On a test project's source, then its target. */
	fixture?: (params: { xml: string; label: 'sourceXml' | 'targetXml'; configKey: string }) => void
}

export type CreateTestHelpersParams<
	GenericConfig extends AnyDialecteConfig,
	GenericModules extends ExtensionModules = Record<never, never>,
	GenericConfigKey extends string = string,
> = DeclaredTestRunnerParams<GenericConfig, GenericModules, GenericConfigKey> & {
	/** Names the schema in fixture violation messages. Defaults to the dialecte's id. */
	schemaName?: string
	extraChecks?: TestHelperExtraChecks
}

export type TestHelperProjectParams = TestProjectOptions & {
	/** Why this call's fixtures skip the extra checks; core's schema check still runs. */
	skipExtraChecks?: string
}

/**
 * Every test helper of a declared dialecte. The runner and the test project check each fixture
 * against the schema of the config it is imported under, then run the extra checks.
 */
export type TestHelpers<
	GenericConfig extends AnyDialecteConfig,
	GenericModules extends ExtensionModules = Record<never, never>,
> = {
	/**
	 * Each case's XML is checked before the suite runs, every invalid case at once: against the
	 * call's `dialecteConfig` when it passes one, else the config under its `configKey`.
	 */
	runTestCases: TestRunner<GenericConfig, GenericModules>
	/** The source and target are checked against the schema (required attributes may be left out). */
	createTestProject: (
		params: TestHelperProjectParams,
	) => Promise<TestProjectResult<GenericConfig, GenericModules>>
	/** Bound to the default config. */
	createTestRecord: ReturnType<typeof createTestRecordFactory<GenericConfig>>
} & XmlAssertions &
	XmlSchemaAssertions
