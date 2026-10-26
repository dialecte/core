import { TEST_DIALECTE_CONFIG } from './config'
import { XMLNS_DEFAULT_NAMESPACE, XMLNS_DEV_NAMESPACE } from './constant'
import { createTestHelpers } from './create-test-helpers'

import Dexie from 'dexie'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { defineDialecte } from '@/dialecte'
import { toDialecteError } from '@/errors'

import type { TestDialecteConfig } from './config'
import type { BaseXmlTestCase } from './run-test-cases.type'

const ns = `${XMLNS_DEFAULT_NAMESPACE} ${XMLNS_DEV_NAMESPACE}`
const VALID_XML = /* xml */ `<Root ${ns}><A aA="ONE"/><B aB="TWO"/></Root>`
/** AA_1 is a schema element, but not a child of Root. */
const MISPLACED_XML = /* xml */ `<Root ${ns}><AA_1 aAA_1="X"/></Root>`

/** The same schema under another default namespace: a binding to it resolves `default:` elsewhere. */
const SECOND_CONFIG = {
	...TEST_DIALECTE_CONFIG,
	namespaces: {
		...TEST_DIALECTE_CONFIG.namespaces,
		default: { uri: 'http://dialecte.dev/XML/SECOND', prefix: '' },
	},
} as unknown as TestDialecteConfig

/** The test schema with AA_1 allowed under Root. */
const AA_1_UNDER_ROOT_CONFIG = {
	...TEST_DIALECTE_CONFIG,
	definition: {
		...TEST_DIALECTE_CONFIG.definition,
		Root: {
			...TEST_DIALECTE_CONFIG.definition.Root,
			children: {
				...TEST_DIALECTE_CONFIG.definition.Root.children,
				sequence: [...TEST_DIALECTE_CONFIG.definition.Root.children.sequence, 'AA_1'],
			},
		},
	},
} as unknown as TestDialecteConfig

const createHooks = vi.fn(function createNoHooks() {
	return {}
})

const dialecte = defineDialecte({
	id: 'core/test',
	version: '0.0.0',
	configs: { test: TEST_DIALECTE_CONFIG, second: SECOND_CONFIG, loose: AA_1_UNDER_ROOT_CONFIG },
	defaultConfigKey: 'test',
	extensions: {
		counting: {
			query: {
				countA: async (query: { getRecordsByTagName: (tagName: 'A') => Promise<unknown[]> }) =>
					(await query.getRecordsByTagName('A')).length,
			},
		},
	},
	createHooks,
})

const helpers = createTestHelpers({ dialecte })

describe('createTestHelpers', () => {
	const projects: Array<{ destroy: () => Promise<void> }> = []
	beforeEach(() => {
		createHooks.mockClear()
	})
	afterEach(async () => {
		await Promise.all(projects.map((project) => project.destroy()))
		projects.length = 0
	})

	it('createTestProject opens the declared dialecte: configs, default key, extensions, own hooks', async () => {
		const { project, source } = await helpers.createTestProject({ sourceXml: VALID_XML })
		projects.push(project)

		expect(createHooks).toHaveBeenCalledTimes(1)
		expect((await project.getDocument(source.documentId))?.configKey).toBe('test')
		expect(await source.document.query.counting.countA()).toBe(1)
		await expect(project.initEmptyDocument({ configKey: 'second' })).resolves.toBeTypeOf('string')
	})

	it('createTestProject passes the dev options to the project', async () => {
		const { project, source } = await helpers.createTestProject({
			sourceXml: VALID_XML,
			dev: { perf: true },
		})
		projects.push(project)
		await source.document.query.getRecordsByTagName('A')
		// a project without dev perf reports nothing
		expect(Object.keys(source.document.perf.report()).length).toBeGreaterThan(0)
	})

	const storageCases: Record<
		string,
		{ helperStorage?: 'inMemory'; callStorage: 'absent' | 'undefined' | 'local'; inMemory: boolean }
	> = {
		'the helpers storage when the call names none': {
			helperStorage: 'inMemory',
			callStorage: 'absent',
			inMemory: true,
		},
		'the helpers storage when the call forwards an undefined one': {
			helperStorage: 'inMemory',
			callStorage: 'undefined',
			inMemory: true,
		},
		'the call storage over the helpers one': {
			helperStorage: 'inMemory',
			callStorage: 'local',
			inMemory: false,
		},
		'the local store when neither names one': { callStorage: 'absent', inMemory: false },
	}

	for (const [description, { helperStorage, callStorage, inMemory }] of Object.entries(
		storageCases,
	)) {
		it(`createTestProject runs on ${description}`, async () => {
			const bound = createTestHelpers({
				dialecte,
				storage: helperStorage ? { type: helperStorage } : undefined,
			})
			const { project } = await bound.createTestProject({
				sourceXml: VALID_XML,
				...(callStorage === 'absent'
					? {}
					: { storage: callStorage === 'local' ? { type: 'local' } : undefined }),
			})
			projects.push(project)
			expect(await Dexie.exists(project.name)).toBe(!inMemory)
		})
	}

	const refusedFixtures: Record<string, { check: () => unknown; expected: RegExp }> = {
		'createTestProject, the source': {
			check: () => helpers.createTestProject({ sourceXml: MISPLACED_XML }),
			expected: /^sourceXml: not valid core\/test:[\s\S]*AA_1/,
		},
		'createTestProject, the target': {
			check: () => helpers.createTestProject({ sourceXml: VALID_XML, targetXml: MISPLACED_XML }),
			expected: /^targetXml: not valid core\/test:[\s\S]*AA_1/,
		},
		'runTestCases, a case, before any case runs': {
			check: () =>
				helpers.runTestCases.withoutExport<BaseXmlTestCase>({
					testCases: { misplaced: { sourceXml: MISPLACED_XML } },
					act: async () => {},
				}),
			expected: /^misplaced › sourceXml: not valid core\/test:[\s\S]*AA_1/,
		},
		'runTestCases with an explicit schemaName': {
			check: () =>
				createTestHelpers({
					dialecte,
					schemaName: 'Test',
				}).runTestCases.withExport<BaseXmlTestCase>({
					testCases: { misplaced: { sourceXml: MISPLACED_XML } },
					act: async () => ({}),
				}),
			expected: /^misplaced › sourceXml: not valid Test:[\s\S]*AA_1/,
		},
	}

	for (const [description, { check, expected }] of Object.entries(refusedFixtures)) {
		it(`refuses a fixture the schema does not allow: ${description}`, async () => {
			let thrown: unknown
			try {
				await check()
			} catch (error) {
				thrown = error
			}
			expect(thrown).toBeInstanceOf(Error)
			expect((thrown as Error).message).toMatch(expected)
		})
	}

	it('createTestRecord is bound to the dialecte config', () => {
		const record = helpers.createTestRecord({ record: { tagName: 'A', attributes: { aA: 'X' } } })
		expect(record.namespace).toEqual(TEST_DIALECTE_CONFIG.namespaces.default)
		// @ts-expect-error a tag the dialecte does not have
		helpers.createTestRecord({ record: { tagName: 'NotAnElement' } })
	})

	it('the XML assertions resolve the default config namespaces', async () => {
		const { project, source } = await helpers.createTestProject({ sourceXml: VALID_XML })
		projects.push(project)
		const { xmlDocument } = await project.export({
			documentId: source.documentId,
			indent: false,
			xmlDocument: true,
		})

		helpers.assertExpectedElementQueries({ xmlDocument, queries: ['//default:A[@aA="ONE"]'] })
		helpers.assertUnexpectedElementQueries({ xmlDocument, queries: ['//default:C'] })
	})

	describe('runTestCases runs valid cases on the declared dialecte', () => {
		helpers.runTestCases.withExport<BaseXmlTestCase>({
			testCases: {
				'the declared extensions are on the source': {
					sourceXml: VALID_XML,
					expectedQueries: ['//default:B[@aB="TWO"]'],
				},
			},
			act: async ({ source }) => {
				expect(await source.query.counting.countA()).toBe(1)
				return {}
			},
		})
	})

	describe('runTestCases checks a case against the schema of the config it passes', () => {
		helpers.runTestCases.withoutExport<BaseXmlTestCase>({
			testCases: { 'AA_1 under Root, allowed by the case config': { sourceXml: MISPLACED_XML } },
			dialecteConfig: AA_1_UNDER_ROOT_CONFIG,
			act: async ({ source }) => {
				expect(await source.query.getRecordsByTagName('AA_1')).toHaveLength(1)
			},
		})
	})

	describe('runTestCases keeps the generic runner', () => {
		helpers.runTestCases.generic({ 'a pure case runs': {} }, () => {
			expect(true).toBe(true)
		})
	})

	describe('a fixture of another declared config, by its key', () => {
		it('createTestProject checks it against that config and stores it under that key', async () => {
			const { project, source, target } = await helpers.createTestProject({
				sourceXml: MISPLACED_XML,
				targetXml: MISPLACED_XML,
				configKey: 'loose',
			})
			projects.push(project)
			expect((await project.getDocument(source.documentId))?.configKey).toBe('loose')
			expect((await project.getDocument(target!.documentId))?.configKey).toBe('loose')
		})

		it('createTestProject refuses an unknown key before touching a store', async () => {
			const thrown = await helpers
				.createTestProject({ sourceXml: VALID_XML, configKey: 'unknown' })
				.catch((error: unknown) => error)
			expect(toDialecteError(thrown)?.key).toBe('UNKNOWN_CONFIG_KEY')
		})

		it('runTestCases refuses an unknown key before any case runs', () => {
			let thrown: unknown
			try {
				helpers.runTestCases.withoutExport<BaseXmlTestCase>({
					testCases: { valid: { sourceXml: VALID_XML } },
					configKey: 'unknown',
					act: async () => {},
				})
			} catch (error) {
				thrown = error
			}
			expect(toDialecteError(thrown)?.key).toBe('UNKNOWN_CONFIG_KEY')
		})

		describe('runTestCases checks and imports each case under that key', () => {
			helpers.runTestCases.withoutExport<BaseXmlTestCase>({
				testCases: { 'AA_1 under Root, allowed by the loose config': { sourceXml: MISPLACED_XML } },
				configKey: 'loose',
				act: async ({ project, source }) => {
					expect((await project.getDocument(source.documentId))?.configKey).toBe('loose')
					expect(await source.query.getRecordsByTagName('AA_1')).toHaveLength(1)
				},
			})
		})
	})

	describe('extra checks run after the schema check', () => {
		const calls: string[] = []
		const checked = createTestHelpers({
			dialecte,
			extraChecks: {
				testCases: function recordTestCases({ testCases, configKey }) {
					calls.push(`cases ${Object.keys(testCases).join(',')} ${configKey}`)
				},
				fixture: function recordFixture({ label, configKey }) {
					calls.push(`fixture ${label} ${configKey}`)
				},
			},
		})
		beforeEach(() => {
			calls.length = 0
		})

		it('the fixture check sees only fixtures the schema allowed, with their label and key', async () => {
			const refused = await checked
				.createTestProject({ sourceXml: MISPLACED_XML })
				.catch((error: unknown) => error)
			expect(refused).toBeInstanceOf(Error)
			expect(calls).toEqual([])

			const { project } = await checked.createTestProject({
				sourceXml: VALID_XML,
				targetXml: MISPLACED_XML,
				configKey: 'loose',
			})
			projects.push(project)
			expect(calls).toEqual(['fixture sourceXml loose', 'fixture targetXml loose'])
		})

		it('a call skips the extra checks with a reason, the schema check still runs', async () => {
			const { project } = await checked.createTestProject({
				sourceXml: VALID_XML,
				skipExtraChecks: 'the fixture needs what the extra check refuses',
			})
			projects.push(project)
			expect(calls).toEqual([])

			const refused = await checked
				.createTestProject({ sourceXml: MISPLACED_XML, skipExtraChecks: 'any reason' })
				.catch((error: unknown) => error)
			expect((refused as Error).message).toMatch(/not valid core\/test/)
		})

		it('the test-case check sees only cases the schema allowed', () => {
			expect(() =>
				checked.runTestCases.withoutExport<BaseXmlTestCase>({
					testCases: { misplaced: { sourceXml: MISPLACED_XML } },
					act: async () => {},
				}),
			).toThrow(/not valid core\/test/)
			expect(calls).toEqual([])
		})

		describe('a valid runner call', () => {
			const collected: string[] = []
			const collecting = createTestHelpers({
				dialecte,
				extraChecks: {
					testCases: function recordTestCases({ testCases, configKey }) {
						collected.push(`cases ${Object.keys(testCases).join(',')} ${configKey}`)
					},
				},
			})
			collecting.runTestCases.withoutExport<BaseXmlTestCase>({
				testCases: { first: { sourceXml: VALID_XML } },
				configKey: 'loose',
				act: async () => {
					expect(collected).toEqual(['cases first loose'])
				},
			})
		})
	})
})
