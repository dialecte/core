import type { BaseXmlTestCase, TestCases } from './run-test-cases.type'
import type { AnyDialecteConfig } from '@/types'

/** The schema assertions of one config, named for the violation messages. */
export type CreateSchemaAssertionsParams = {
	config: AnyDialecteConfig
	schemaName: string
}

/** Which schema a fixture is checked against: a case's own config, else the config under the key. */
export type SchemaAssertionsForParams<GenericConfig extends AnyDialecteConfig> = {
	configKey: string | undefined
	caseConfig?: GenericConfig
}

/** What a runner call gives the fixture checks. */
export type CheckTestCasesParams<GenericConfig extends AnyDialecteConfig> = {
	testCases: TestCases<BaseXmlTestCase>
	configKey?: string
	dialecteConfig?: GenericConfig
}
