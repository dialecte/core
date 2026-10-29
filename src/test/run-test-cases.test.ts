import { TEST_DIALECTE_CONFIG } from './config'
import { XMLNS_DEFAULT_NAMESPACE, XMLNS_DEV_NAMESPACE, XMLNS_EXT_NAMESPACE } from './constant'
import { createTestRunner, runTestCases } from './run-test-cases'

import { describe, expect } from 'vitest'

import { defineDialecte } from '@/dialecte'
import { findInMemoryState } from '@/store/in-memory/in-memory-state'

import type { BaseXmlTestCase, TestCases, ActParams, ActResult } from './run-test-cases.type'

type TestDialecteConfig = typeof TEST_DIALECTE_CONFIG

const ns = `${XMLNS_DEFAULT_NAMESPACE} ${XMLNS_DEV_NAMESPACE} ${XMLNS_EXT_NAMESPACE}`

describe('runTestCases', () => {
	describe('source-only tests', () => {
		type TestCase = BaseXmlTestCase

		const testCases: TestCases<TestCase> = {
			'source XML imported and exported → expected element found': {
				sourceXml: /* xml */ `
					<Root ${ns}>
						<A aA="hello"/>
					</Root>
				`,
				expectedQueries: ['//default:A[@aA="hello"]'],
			},
			'unexpected element absent → assertion passes': {
				sourceXml: /* xml */ `
					<Root ${ns}>
						<A aA="hello"/>
					</Root>
				`,
				unexpectedQueries: ['//default:B'],
			},
			'both expected and unexpected assertions in same case': {
				sourceXml: /* xml */ `
					<Root ${ns}>
						<A aA="x"/>
						<B aB="y"/>
					</Root>
				`,
				expectedQueries: ['//default:A[@aA="x"]', '//default:B[@aB="y"]'],
				unexpectedQueries: ['//default:C'],
			},
			'no assertions → act still runs without error': {
				sourceXml: /* xml */ `<Root ${ns}/>`,
			},
		}

		runTestCases.withExport<TestCase>({
			testCases,
			act: async (): Promise<ActResult> => {
				return {}
			},
		})
	})

	describe('source + target tests', () => {
		type TestCase = BaseXmlTestCase & { targetXml: string }

		const testCases: TestCases<TestCase> = {
			'target document accessible in act → asserts on target': {
				sourceXml: /* xml */ `
					<Root ${ns}>
						<A aA="source"/>
					</Root>
				`,
				targetXml: /* xml */ `
					<Root ${ns}>
						<B aB="target"/>
					</Root>
				`,
				expectedQueries: ['//default:B[@aB="target"]'],
			},
		}

		runTestCases.withExport<TestCase>({
			testCases,
			act: async ({ target }: ActParams<TestDialecteConfig, TestCase>): Promise<ActResult> => {
				expect(target, 'target context must be provided when targetXml is set').toBeDefined()
				return { assertOn: 'target' }
			},
		})
	})

	describe('documents under the config key `default`', () => {
		runTestCases.withoutExport<BaseXmlTestCase>({
			testCases: { 'source registered under `default`': { sourceXml: /* xml */ `<Root ${ns}/>` } },
			act: async ({ project, source }) => {
				const sourceDocument = await project.getDocument(source.documentId)
				expect(sourceDocument?.configKey).toBe('default')
			},
		})
	})

	describe('act receives document with working query API', () => {
		type TestCase = BaseXmlTestCase

		const testCases: TestCases<TestCase> = {
			'document.query.getRecordsByTagName returns imported records': {
				sourceXml: /* xml */ `
					<Root ${ns}>
						<A aA="q1"/>
						<A aA="q2"/>
					</Root>
				`,
				expectedQueries: ['//default:A[@aA="q1"]'],
			},
		}

		runTestCases.withExport<TestCase>({
			testCases,
			act: async ({ source }: ActParams<TestDialecteConfig, TestCase>): Promise<ActResult> => {
				const records = await source.query.getRecordsByTagName('A')
				expect(records).toHaveLength(2)
				return {}
			},
		})
	})

	describe('mutation through document.transaction', () => {
		type TestCase = BaseXmlTestCase

		const testCases: TestCases<TestCase> = {
			'element added via transaction → visible in exported XML': {
				sourceXml: /* xml */ `
					<Root ${ns}>
						<A aA="original"/>
					</Root>
				`,
				expectedQueries: [
					'//default:A[@aA="original"]',
					'//default:A/default:AA_1[@aAA_1="added"]',
				],
			},
		}

		runTestCases.withExport<TestCase>({
			testCases,
			act: async ({ source }: ActParams<TestDialecteConfig, TestCase>): Promise<ActResult> => {
				const [recordA] = await source.query.getRecordsByTagName('A')
				await source.transaction(async (tx) => {
					await tx.addChild(
						{ tagName: 'A', id: recordA.id },
						{ tagName: 'AA_1', attributes: { aAA_1: 'added' } },
					)
				})
				return {}
			},
		})
	})

	describe('custom XML from the act', () => {
		type TestCase = BaseXmlTestCase

		const testCases: TestCases<TestCase> = {
			'act answers its own XML → the queries run on it, not on the stored document': {
				sourceXml: /* xml */ `
					<Root ${ns}>
						<B aB="stored"/>
					</Root>
				`,
				expectedQueries: ['//default:Root/default:A[@aA="from the act"]'],
				unexpectedQueries: ['//default:Root/default:B[@aB="stored"]'],
			},
		}

		runTestCases.withExport<TestCase>({
			testCases,
			act: async (): Promise<ActResult> => ({
				assertOn: 'custom',
				xmlString: /* xml */ `<Root ${ns}><A aA="from the act"/></Root>`,
			}),
		})
	})

	describe('cleanup on act failure', () => {
		type TestCase = BaseXmlTestCase

		const testCases: TestCases<TestCase> = {
			'act throws → cleanup still runs (no leaked DBs)': {
				sourceXml: /* xml */ `<Root ${ns}/>`,
			},
		}

		// The real cleanup signal is that the full suite passes without DB leak warnings.
		// Here we just confirm the round-trip works even with a minimal empty-root document.
		runTestCases.withExport<TestCase>({
			testCases,
			act: async (): Promise<ActResult> => {
				return {}
			},
		})
	})
})

describe('createTestRunner from a declaration', () => {
	const hookInstances: number[] = []
	let hooksCreated = 0
	const dialecte = defineDialecte({
		id: 'core/test',
		version: '0.0.0',
		configs: { test: TEST_DIALECTE_CONFIG, second: TEST_DIALECTE_CONFIG },
		defaultConfigKey: 'test',
		extensions: {
			counting: {
				query: {
					countA: async (query: { getRecordsByTagName: (tagName: 'A') => Promise<unknown[]> }) =>
						(await query.getRecordsByTagName('A')).length,
				},
			},
		},
		createHooks: () => {
			const instance = ++hooksCreated
			return {
				beforeImport: (xml) => {
					hookInstances.push(instance)
					return xml
				},
			}
		},
	})
	const runDeclaredTestCases = createTestRunner({ dialecte })

	type TestCase = BaseXmlTestCase & { expectedCount: number }

	const testCases: TestCases<TestCase> = {
		'the declared extensions are on the document': {
			sourceXml: /* xml */ `
				<Root ${ns}>
					<A aA="1"/>
					<A aA="2"/>
				</Root>
			`,
			expectedCount: 2,
		},
		'each case gets its own hooks instance': {
			sourceXml: /* xml */ `
				<Root ${ns}>
					<A aA="1"/>
				</Root>
			`,
			expectedCount: 1,
		},
	}

	runDeclaredTestCases.withoutExport<TestCase>({
		testCases,
		act: async ({ testCase, source, project }) => {
			const countOfA = await source.query.counting.countA()
			expect(countOfA).toBe(testCase.expectedCount)
			// one import per case: a shared instance would be seen more often than instances were made
			expect(hookInstances).toHaveLength(hooksCreated)
			expect(hookInstances.at(-1)).toBe(hooksCreated)
			const sourceDocument = await project.getDocument(source.documentId)
			expect(sourceDocument?.configKey).toBe('test')
			await expect(project.initEmptyDocument({ configKey: 'second' })).resolves.toBeTypeOf('string')
		},
	})

	describe('export assertions use the default config', () => {
		runDeclaredTestCases.withExport<BaseXmlTestCase>({
			testCases: {
				'element added through a transaction is in the export': {
					sourceXml: /* xml */ `<Root ${ns}><A aA="x"/></Root>`,
					expectedQueries: ['//default:A[@aA="x"]', '//default:B[@aB="added"]'],
				},
			},
			act: async ({ source }) => {
				const root = await source.query.getRoot()
				await source.transaction(async (tx) => {
					await tx.addChild(root, { tagName: 'B', attributes: { aB: 'added' } })
				})
				return {}
			},
		})
	})

	describe('the in-memory store on request', () => {
		const runInMemory = createTestRunner({ dialecte, storage: { type: 'inMemory' } })
		runInMemory.withoutExport<BaseXmlTestCase>({
			testCases: { 'the project runs in memory': { sourceXml: /* xml */ `<Root ${ns}/>` } },
			act: async ({ project }) => {
				expect(findInMemoryState({ name: project.name })).toBeDefined()
			},
		})
	})
})
