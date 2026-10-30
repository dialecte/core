import { assertXmlQueries, toXmlNamespaces } from './assert-xml/assert-xml'
import { TEST_DIALECTE } from './test-dialecte'
import {
	openTestProject,
	overrideTestDialecte,
	resolveTestConfig,
	resolveTestDialecte,
} from './test-dialecte-setup'

import { it } from 'vitest'

import type { DeclaredTestRunnerParams, LegacyTestRunnerParams } from './create-test-dialecte.types'
import type {
	BaseTestCase,
	BaseXmlTestCase,
	TestCases,
	ActParams,
	ActResult,
	TestRunner,
} from './run-test-cases.type'
import type { CaseOverrides, RunnerSetup } from './test-dialecte-setup.types'
import type { ExtensionModules } from '@/document'
import type { AnyDialecteConfig } from '@/types'

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
	GenericConfig extends AnyDialecteConfig,
	GenericModules extends ExtensionModules = Record<never, never>,
>(
	params: RunnerSetup<GenericConfig> &
		CaseOverrides<GenericConfig> & {
			testCases: TestCases<GenericTestCase>
			act: (
				params: ActParams<GenericConfig, GenericTestCase, GenericModules>,
			) => Promise<ActResult | void>
		},
): void {
	const { testCases, act, storage, dev, configKey, dialecteConfig, hooks } = params
	const setup = overrideTestDialecte({ setup: params.setup, configKey, dialecteConfig, hooks })
	const { config } = resolveTestConfig({ setup, configKey })

	const namespaces = toXmlNamespaces(config.namespaces)

	for (const [description, testCase] of Object.entries(testCases)) {
		const testFn = testCase.only ? it.only : it

		testFn(description, async () => {
			crypto.randomUUID = originalRandomUUID

			const { project, source, target } = await openTestProject<GenericConfig, GenericModules>({
				setup,
				sourceXml: testCase.sourceXml,
				targetXml: testCase.targetXml,
				configKey,
				storage,
				dev,
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
				let xml: string
				if (result && result.assertOn === 'custom') {
					xml = result.xmlString
				} else {
					const assertOn = result?.assertOn ?? 'source'
					const withDatabaseIds = result?.withDatabaseIds ?? true
					const exportFileId = assertOn === 'target' ? target?.documentId : source.documentId

					if (!exportFileId) throw new Error('documentId required for export')
					const { file } = await project.export({
						documentId: exportFileId,
						indent: false,
						withDatabaseIds,
					})
					xml = await file.text()
				}

				// one parse of the output for both lists: the expected queries, then the unexpected ones
				if (testCase.expectedQueries?.length || testCase.unexpectedQueries?.length) {
					assertXmlQueries({
						xml,
						namespaces,
						expectedQueries: testCase.expectedQueries,
						unexpectedQueries: testCase.unexpectedQueries,
					})
				}
			} finally {
				crypto.randomUUID = originalRandomUUID
				await project.destroy()
			}
		})
	}
}

function xmlWithoutExport<
	GenericTestCase extends BaseXmlTestCase,
	GenericConfig extends AnyDialecteConfig,
	GenericModules extends ExtensionModules = Record<never, never>,
>(
	params: RunnerSetup<GenericConfig> &
		CaseOverrides<GenericConfig> & {
			testCases: TestCases<GenericTestCase>
			act: (params: ActParams<GenericConfig, GenericTestCase, GenericModules>) => Promise<void>
		},
): void {
	const { testCases, act, storage, dev, configKey, dialecteConfig, hooks } = params
	const setup = overrideTestDialecte({ setup: params.setup, configKey, dialecteConfig, hooks })

	for (const [description, testCase] of Object.entries(testCases)) {
		const testFn = testCase.only ? it.only : it

		testFn(description, async () => {
			crypto.randomUUID = originalRandomUUID

			const { project, source, target } = await openTestProject<GenericConfig, GenericModules>({
				setup,
				sourceXml: testCase.sourceXml,
				targetXml: testCase.targetXml,
				configKey,
				storage,
				dev,
			})

			try {
				crypto.randomUUID = createMockRandomUUID()

				await act({ testCase, project, source: source.document, target: target?.document })
			} finally {
				crypto.randomUUID = originalRandomUUID
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

/**
 * The test runner of a declared dialecte: each case runs on a fresh project with every config,
 * the default key, the dialecte's extensions and its own hooks instance, on the store `storage`
 * names (the local one by default).
 */
export function createTestRunner<
	GenericConfig extends AnyDialecteConfig,
	GenericModules extends ExtensionModules = Record<never, never>,
	GenericConfigKey extends string = string,
>(
	params: DeclaredTestRunnerParams<GenericConfig, GenericModules, GenericConfigKey>,
): TestRunner<GenericConfig, GenericModules>
/**
 * A test runner from a config, extensions and one hooks instance shared by every case.
 * @deprecated Declare the dialecte with `defineDialecte` and pass it as `dialecte`.
 */
export function createTestRunner<
	GenericConfig extends AnyDialecteConfig,
	GenericModules extends ExtensionModules = Record<never, never>,
>(params: LegacyTestRunnerParams<GenericConfig>): TestRunner<GenericConfig, GenericModules>
export function createTestRunner(
	params:
		| DeclaredTestRunnerParams<AnyDialecteConfig, ExtensionModules, string>
		| LegacyTestRunnerParams<AnyDialecteConfig>,
): TestRunner<AnyDialecteConfig, ExtensionModules> {
	const { storage } = params
	const setup = resolveTestDialecte(params)
	return {
		withExport: (caseParams) => xmlWithExport({ setup, storage, ...caseParams }),
		withoutExport: (caseParams) => xmlWithoutExport({ setup, storage, ...caseParams }),
		generic: genericTestCases,
	}
}

/** Core's own runner: the declared test dialecte on the local store. */
export const runTestCases = createTestRunner({ dialecte: TEST_DIALECTE })
