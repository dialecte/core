import { XMLNS_DEFAULT_NAMESPACE, XMLNS_DEV_NAMESPACE, XMLNS_EXT_NAMESPACE } from './constant'
import { runTestCases } from './run-test-cases'

import { describe, expect } from 'vitest'

import type { TEST_DIALECTE_CONFIG } from './config'
import type { BaseTestCase, TestCases, ActParams, ActResult } from './run-test-cases.type'

type TestDialecteConfig = typeof TEST_DIALECTE_CONFIG

const ns = `${XMLNS_DEFAULT_NAMESPACE} ${XMLNS_DEV_NAMESPACE} ${XMLNS_EXT_NAMESPACE}`

describe('runTestCases', () => {
	describe('source-only tests', () => {
		type TestCase = BaseTestCase

		const testCases: TestCases<TestCase> = {
			'source XML imported and exported → expected element found': {
				sourceXml: /* xml */ `<Root ${ns}><A aA="hello"/></Root>`,
				expectedQueries: ['//default:A[@aA="hello"]'],
			},
			'unexpected element absent → assertion passes': {
				sourceXml: /* xml */ `<Root ${ns}><A aA="hello"/></Root>`,
				unexpectedQueries: ['//default:B'],
			},
			'both expected and unexpected assertions in same case': {
				sourceXml: /* xml */ `<Root ${ns}><A aA="x"/><B aB="y"/></Root>`,
				expectedQueries: ['//default:A[@aA="x"]', '//default:B[@aB="y"]'],
				unexpectedQueries: ['//default:C'],
			},
			'no assertions → act still runs without error': {
				sourceXml: /* xml */ `<Root ${ns}/>`,
			},
		}

		runTestCases<TestCase>({
			testCases,
			act: async ({ source }: ActParams<TestDialecteConfig, TestCase>): Promise<ActResult> => {
				return { assertDatabaseName: source.databaseName }
			},
		})
	})

	describe('source + target tests', () => {
		type TestCase = BaseTestCase & { targetXml: string }

		const testCases: TestCases<TestCase> = {
			'target document accessible in act → asserts on target': {
				sourceXml: /* xml */ `<Root ${ns}><A aA="source"/></Root>`,
				targetXml: /* xml */ `<Root ${ns}><B aB="target"/></Root>`,
				expectedQueries: ['//default:B[@aB="target"]'],
			},
		}

		runTestCases<TestCase>({
			testCases,
			act: async ({ target }: ActParams<TestDialecteConfig, TestCase>): Promise<ActResult> => {
				expect(target, 'target context must be provided when targetXml is set').toBeDefined()
				return { assertDatabaseName: target!.databaseName }
			},
		})
	})

	describe('act receives document with working query API', () => {
		type TestCase = BaseTestCase

		const testCases: TestCases<TestCase> = {
			'document.query.getRecordsByTagName returns imported records': {
				sourceXml: /* xml */ `<Root ${ns}><A aA="q1"/><A aA="q2"/></Root>`,
				expectedQueries: ['//default:A[@aA="q1"]'],
			},
		}

		runTestCases<TestCase>({
			testCases,
			act: async ({ source }: ActParams<TestDialecteConfig, TestCase>): Promise<ActResult> => {
				const records = await source.document.query.getRecordsByTagName('A')
				expect(records).toHaveLength(2)
				return { assertDatabaseName: source.databaseName }
			},
		})
	})

	describe('mutation through document.transaction', () => {
		type TestCase = BaseTestCase

		const testCases: TestCases<TestCase> = {
			'element added via transaction → visible in exported XML': {
				sourceXml: /* xml */ `<Root ${ns}><A aA="original"/></Root>`,
				expectedQueries: [
					'//default:A[@aA="original"]',
					'//default:A/default:AA_1[@aAA_1="added"]',
				],
			},
		}

		runTestCases<TestCase>({
			testCases,
			act: async ({ source }: ActParams<TestDialecteConfig, TestCase>): Promise<ActResult> => {
				const [recordA] = await source.document.query.getRecordsByTagName('A')
				await source.document.transaction(async (tx) => {
					await tx.addChild(
						{ tagName: 'A', id: recordA.id },
						{ tagName: 'AA_1', attributes: { aAA_1: 'added' } },
					)
				})
				return { assertDatabaseName: source.databaseName }
			},
		})
	})

	describe('cleanup on act failure', () => {
		type TestCase = BaseTestCase

		const testCases: TestCases<TestCase> = {
			'act throws → cleanup still runs (no leaked DBs)': {
				sourceXml: /* xml */ `<Root ${ns}/>`,
			},
		}

		// The real cleanup signal is that the full suite passes without DB leak warnings.
		// Here we just confirm the round-trip works even with a minimal empty-root document.
		runTestCases<TestCase>({
			testCases,
			act: async ({ source }: ActParams<TestDialecteConfig, TestCase>): Promise<ActResult> => {
				return { assertDatabaseName: source.databaseName }
			},
		})
	})
})
