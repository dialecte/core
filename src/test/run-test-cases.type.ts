import type { Document } from '@/document'
import type { AnyDialecteConfig, TransactionHooks } from '@/types'

export type BaseTestCase = {
	only?: boolean
}

export type BaseXmlTestCase = BaseTestCase & {
	sourceXml: string
	targetXml?: string
	expectedQueries?: string[]
	unexpectedQueries?: string[]
}

export type TestCases<GenericTestCase extends BaseXmlTestCase> = Record<string, GenericTestCase>

export type TestContext<GenericConfig extends AnyDialecteConfig> = {
	document: Document<GenericConfig>
	databaseName: string
}

export type ActParams<
	GenericConfig extends AnyDialecteConfig,
	GenericTestCase extends BaseXmlTestCase,
> = {
	testCase: GenericTestCase
	source: TestContext<GenericConfig>
	target?: TestContext<GenericConfig>
}

export type ActResult = {
	assertDatabaseName: string
	withDatabaseIds?: boolean
}

export type TestRunner<GenericConfig extends AnyDialecteConfig> = {
	withExport<GenericTestCase extends BaseXmlTestCase>(params: {
		testCases: TestCases<GenericTestCase>
		act: (params: ActParams<GenericConfig, GenericTestCase>) => Promise<ActResult>
		dialecteConfig?: GenericConfig
		hooks?: TransactionHooks<GenericConfig>
	}): void
	withoutExport<GenericTestCase extends BaseXmlTestCase>(params: {
		testCases: TestCases<GenericTestCase>
		act: (params: ActParams<GenericConfig, GenericTestCase>) => Promise<void>
		dialecteConfig?: GenericConfig
		hooks?: TransactionHooks<GenericConfig>
	}): void
	generic<GenericTestCase extends BaseTestCase>(
		testCases: Record<string, GenericTestCase>,
		act: (testCase: GenericTestCase) => void,
	): void
}
