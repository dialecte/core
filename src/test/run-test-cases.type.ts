import type { Document, ExtensionModules, MergedExtensions } from '@/document'
import type { Project } from '@/project'
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

export type ActParams<
	GenericConfig extends AnyDialecteConfig,
	GenericTestCase extends BaseXmlTestCase,
	GenericModules extends ExtensionModules = Record<never, never>,
> = {
	testCase: GenericTestCase
	project: Project<GenericConfig, GenericModules>
	source: Document<GenericConfig, MergedExtensions<GenericModules>>
	target?: Document<GenericConfig, MergedExtensions<GenericModules>>
}

export type ActResult =
	| {
			assertOn?: 'source' | 'target'
			withDatabaseIds?: boolean
	  }
	| {
			assertOn: 'custom'
			/**
			 * XML produced inside the act (e.g. `getSnapshot({ as: 'xml' })`) to assert
			 * `expectedQueries`/`unexpectedQueries` against, instead of exporting the
			 * stored document.
			 */
			xmlString: string
	  }

export type TestRunner<
	GenericConfig extends AnyDialecteConfig,
	GenericModules extends ExtensionModules = Record<never, never>,
> = {
	withExport<GenericTestCase extends BaseXmlTestCase>(params: {
		testCases: TestCases<GenericTestCase>
		act: (
			params: ActParams<GenericConfig, GenericTestCase, GenericModules>,
		) => Promise<ActResult | void>
		dialecteConfig?: GenericConfig
		hooks?: TransactionHooks<GenericConfig>
	}): void
	withoutExport<GenericTestCase extends BaseXmlTestCase>(params: {
		testCases: TestCases<GenericTestCase>
		act: (params: ActParams<GenericConfig, GenericTestCase, GenericModules>) => Promise<void>
		dialecteConfig?: GenericConfig
		hooks?: TransactionHooks<GenericConfig>
	}): void
	generic<GenericTestCase extends BaseTestCase>(
		testCases: Record<string, GenericTestCase>,
		act: (testCase: GenericTestCase) => void,
	): void
}
