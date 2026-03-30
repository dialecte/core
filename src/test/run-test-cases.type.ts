import type { Document } from '@/document'
import type { AnyDialecteConfig } from '@/types'

export type BaseTestCase = {
	sourceXml: string
	targetXml?: string
	only?: boolean
	expectedQueries?: string[]
	unexpectedQueries?: string[]
}

export type TestCases<GenericTestCase extends BaseTestCase> = Record<string, GenericTestCase>

export type TestContext<GenericConfig extends AnyDialecteConfig> = {
	document: Document<GenericConfig>
	databaseName: string
}

export type ActParams<
	GenericConfig extends AnyDialecteConfig,
	GenericTestCase extends BaseTestCase,
> = {
	testCase: GenericTestCase
	source: TestContext<GenericConfig>
	target?: TestContext<GenericConfig>
}

export type ActResult = {
	assertDatabaseName: string
	withDatabaseIds?: boolean
}
