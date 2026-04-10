import { createXmlAssertions } from './assert-xml'
import { TEST_DIALECTE_CONFIG } from './config'
import { createTestDialecte } from './create-test-dialecte'

import { it } from 'vitest'

import { exportXmlFile } from '@/io'

import type {
	BaseTestCase,
	BaseXmlTestCase,
	TestCases,
	ActParams,
	ActResult,
} from './run-test-cases.type'
import type { AnyDialecteConfig } from '@/types'

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
	act: (params: ActParams<GenericConfig, GenericTestCase>) => Promise<ActResult>
	dialecteConfig?: GenericConfig
}): void {
	const {
		testCases,
		act,
		dialecteConfig = TEST_DIALECTE_CONFIG as unknown as GenericConfig,
	} = params

	const { assertExpectedElementQueries, assertUnexpectedElementQueries } = createXmlAssertions({
		namespaces: dialecteConfig.namespaces,
	})

	for (const [description, testCase] of Object.entries(testCases)) {
		const testFn = testCase.only ? it.only : it

		testFn(description, async () => {
			crypto.randomUUID = originalRandomUUID

			const source = await createTestDialecte({ xmlString: testCase.sourceXml, dialecteConfig })
			const target = testCase.targetXml
				? await createTestDialecte({ xmlString: testCase.targetXml, dialecteConfig })
				: undefined

			try {
				crypto.randomUUID = createMockRandomUUID()

				const { assertDatabaseName, withDatabaseIds } = await act({
					testCase,
					source: { document: source.document, databaseName: source.databaseName },
					target: target
						? { document: target.document, databaseName: target.databaseName }
						: undefined,
				})

				const { xmlDocument } = await exportXmlFile({
					dialecteConfig,
					databaseName: assertDatabaseName,
					extension: dialecteConfig.io.supportedFileExtensions[0],
					withDatabaseIds: withDatabaseIds ?? true,
				})

				if (testCase.expectedQueries?.length) {
					assertExpectedElementQueries({ xmlDocument, queries: testCase.expectedQueries })
				}

				if (testCase.unexpectedQueries?.length) {
					assertUnexpectedElementQueries({ xmlDocument, queries: testCase.unexpectedQueries })
				}
			} finally {
				await source.cleanup()
				await target?.cleanup()
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
}): void {
	const {
		testCases,
		act,
		dialecteConfig = TEST_DIALECTE_CONFIG as unknown as GenericConfig,
	} = params

	for (const [description, testCase] of Object.entries(testCases)) {
		const testFn = testCase.only ? it.only : it

		testFn(description, async () => {
			crypto.randomUUID = originalRandomUUID

			const source = await createTestDialecte({ xmlString: testCase.sourceXml, dialecteConfig })
			const target = testCase.targetXml
				? await createTestDialecte({ xmlString: testCase.targetXml, dialecteConfig })
				: undefined

			try {
				crypto.randomUUID = createMockRandomUUID()

				await act({
					testCase,
					source: { document: source.document, databaseName: source.databaseName },
					target: target
						? { document: target.document, databaseName: target.databaseName }
						: undefined,
				})
			} finally {
				await source.cleanup()
				await target?.cleanup()
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
): {
	withExport<GenericTestCase extends BaseXmlTestCase>(params: {
		testCases: TestCases<GenericTestCase>
		act: (params: ActParams<GenericConfig, GenericTestCase>) => Promise<ActResult>
		dialecteConfig?: GenericConfig
	}): void
	withoutExport<GenericTestCase extends BaseXmlTestCase>(params: {
		testCases: TestCases<GenericTestCase>
		act: (params: ActParams<GenericConfig, GenericTestCase>) => Promise<void>
		dialecteConfig?: GenericConfig
	}): void
	generic: typeof genericTestCases
} {
	return {
		withExport: (params) => xmlWithExport({ dialecteConfig, ...params }),
		withoutExport: (params) => xmlWithoutExport({ dialecteConfig, ...params }),
		generic: genericTestCases,
	}
}
