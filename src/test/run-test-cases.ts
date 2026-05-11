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
>(params: {
	testCases: TestCases<GenericTestCase>
	act: (params: ActParams<GenericConfig, GenericTestCase>) => Promise<ActResult | void>
	dialecteConfig?: GenericConfig
	hooks?: TransactionHooks<GenericConfig>
}): void {
	const {
		testCases,
		act,
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

			const { project, source, target } = await createTestProject({
				sourceXml: testCase.sourceXml,
				targetXml: testCase.targetXml,
				dialecteConfig,
				hooks,
			})

			try {
				crypto.randomUUID = createMockRandomUUID()

				const result = await act({ testCase, source: source.document, target: target?.document })

				const assertOn = result?.assertOn ?? 'source'
				const withDatabaseIds = result?.withDatabaseIds ?? true
				const exportFileId = assertOn === 'target' ? target!.documentId : source.documentId

				const { xmlDocument } = await project.export(exportFileId, { withDatabaseIds })

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
>(params: {
	testCases: TestCases<GenericTestCase>
	act: (params: ActParams<GenericConfig, GenericTestCase>) => Promise<void>
	dialecteConfig?: GenericConfig
	hooks?: TransactionHooks<GenericConfig>
}): void {
	const {
		testCases,
		act,
		hooks,
		dialecteConfig = TEST_DIALECTE_CONFIG as unknown as GenericConfig,
	} = params

	for (const [description, testCase] of Object.entries(testCases)) {
		const testFn = testCase.only ? it.only : it

		testFn(description, async () => {
			crypto.randomUUID = originalRandomUUID

			const { project, source, target } = await createTestProject({
				sourceXml: testCase.sourceXml,
				targetXml: testCase.targetXml,
				dialecteConfig,
				hooks,
			})

			try {
				crypto.randomUUID = createMockRandomUUID()

				await act({ testCase, source: source.document, target: target?.document })
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

export const runTestCases = createTestRunner(TEST_DIALECTE_CONFIG)

export function createTestRunner<GenericConfig extends AnyDialecteConfig>(
	dialecteConfig: GenericConfig,
	hooks?: TransactionHooks<GenericConfig>,
): TestRunner<GenericConfig> {
	return {
		withExport: (params) => xmlWithExport({ dialecteConfig, hooks, ...params }),
		withoutExport: (params) => xmlWithoutExport({ dialecteConfig, hooks, ...params }),
		generic: genericTestCases,
	}
}
