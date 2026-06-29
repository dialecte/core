import { createXmlAssertions } from './assert-xml'
import { TEST_DIALECTE_CONFIG } from './config'
import { createTestProject } from './create-test-dialecte'

import { it } from 'vitest'

import type {
	BaseTestCase,
	BaseXmlTestCase,
	TestCases,
	ActParams,
	ActResult,
	TestRunner,
} from './run-test-cases.type'
import type { ExtensionModules } from '@/document'
import type { AnyDialecteConfig, TransactionHooks } from '@/types'

type TestDialecteConfig = typeof TEST_DIALECTE_CONFIG

// ── UUID mocking ─────────────────────────────────────────────────────────────

const originalRandomUUID = crypto.randomUUID.bind(crypto)

export function createMockRandomUUID(): () => `${string}-${string}-${string}-${string}-${string}` {
	let counter = 0
	return function () {
		return `${counter++}` as `${string}-${string}-${string}-${string}-${string}`
	}
}

// ── Runner ───────────────────────────────────────────────────────────────────

function xmlWithExport<
	GenericTestCase extends BaseXmlTestCase,
	GenericConfig extends AnyDialecteConfig = TestDialecteConfig,
	GenericModules extends ExtensionModules = Record<never, never>,
>(params: {
	testCases: TestCases<GenericTestCase>
	act: (
		params: ActParams<GenericConfig, GenericTestCase, GenericModules>,
	) => Promise<ActResult | void>
	dialecteConfig?: GenericConfig
	extensions?: { base?: ExtensionModules; custom?: ExtensionModules }
	hooks?: TransactionHooks<GenericConfig>
}): void {
	const {
		testCases,
		act,
		extensions,
		hooks,
		dialecteConfig = TEST_DIALECTE_CONFIG as unknown as GenericConfig,
	} = params

	const { assertExpectedElementQueries, assertUnexpectedElementQueries } = createXmlAssertions({
		namespaces: dialecteConfig.namespaces,
	})

	for (const [description, testCase] of Object.entries(testCases)) {
		const testFn = testCase.only ? it.only : it

		testFn(description, async () => {
			crypto.randomUUID = originalRandomUUID

			const { project, source, target } = await createTestProject<GenericConfig, GenericModules>({
				sourceXml: testCase.sourceXml,
				targetXml: testCase.targetXml,
				dialecteConfig,
				extensions,
				hooks,
			})

			try {
				crypto.randomUUID = createMockRandomUUID()

				const result = await act({
					testCase,
					project,
					source: source.document,
					target: target?.document,
				})

				// `assertOn: 'custom'` asserts the queries against XML produced inside
				// the act (e.g. a getSnapshot xml output), instead of exporting the
				// stored document — lets custom XML be tested with the same matcher.
				let xmlDocument: XMLDocument
				if (result && result.assertOn === 'custom') {
					xmlDocument = new DOMParser().parseFromString(result.xmlString, 'application/xml')
				} else {
					const assertOn = result?.assertOn ?? 'source'
					const withDatabaseIds = result?.withDatabaseIds ?? true
					const exportFileId = assertOn === 'target' ? target?.documentId : source.documentId

					if (!exportFileId) throw new Error('documentId required for export')
					;({ xmlDocument } = await project.export(exportFileId, { withDatabaseIds }))
				}

				if (testCase.expectedQueries?.length) {
					assertExpectedElementQueries({ xmlDocument, queries: testCase.expectedQueries })
				}

				if (testCase.unexpectedQueries?.length) {
					assertUnexpectedElementQueries({ xmlDocument, queries: testCase.unexpectedQueries })
				}
			} finally {
				await project.destroy()
			}
		})
	}
}

function xmlWithoutExport<
	GenericTestCase extends BaseXmlTestCase,
	GenericConfig extends AnyDialecteConfig = TestDialecteConfig,
	GenericModules extends ExtensionModules = Record<never, never>,
>(params: {
	testCases: TestCases<GenericTestCase>
	act: (params: ActParams<GenericConfig, GenericTestCase, GenericModules>) => Promise<void>
	dialecteConfig?: GenericConfig
	extensions?: { base?: ExtensionModules; custom?: ExtensionModules }
	hooks?: TransactionHooks<GenericConfig>
}): void {
	const {
		testCases,
		act,
		extensions,
		hooks,
		dialecteConfig = TEST_DIALECTE_CONFIG as unknown as GenericConfig,
	} = params

	for (const [description, testCase] of Object.entries(testCases)) {
		const testFn = testCase.only ? it.only : it

		testFn(description, async () => {
			crypto.randomUUID = originalRandomUUID

			const { project, source, target } = await createTestProject<GenericConfig, GenericModules>({
				sourceXml: testCase.sourceXml,
				targetXml: testCase.targetXml,
				dialecteConfig,
				extensions,
				hooks,
			})

			try {
				crypto.randomUUID = createMockRandomUUID()

				await act({ testCase, project, source: source.document, target: target?.document })
			} finally {
				await project.destroy()
			}
		})
	}
}

function genericTestCases<GenericTestCase extends BaseTestCase>(
	testCases: Record<string, GenericTestCase>,
	act: (testCase: GenericTestCase) => void,
): void {
	for (const [description, testCase] of Object.entries(testCases)) {
		const testFn = testCase.only ? it.only : it
		testFn(description, () => act(testCase))
	}
}

export const runTestCases = createTestRunner({ dialecteConfig: TEST_DIALECTE_CONFIG })

export function createTestRunner<
	GenericConfig extends AnyDialecteConfig,
	GenericModules extends ExtensionModules = Record<never, never>,
>(params: {
	dialecteConfig: GenericConfig
	hooks?: TransactionHooks<GenericConfig>
	extensions?: { base?: ExtensionModules; custom?: ExtensionModules }
}): TestRunner<GenericConfig, GenericModules> {
	const { dialecteConfig, hooks, extensions } = params
	return {
		withExport: (params) => xmlWithExport({ dialecteConfig, extensions, hooks, ...params }),
		withoutExport: (params) => xmlWithoutExport({ dialecteConfig, extensions, hooks, ...params }),
		generic: genericTestCases,
	}
}
