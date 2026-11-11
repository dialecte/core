import { describe, expect, it, afterEach } from 'vitest'

import { defineErrors, throwDialecteError, toDialecteError } from '@/errors'
import { CUSTOM_RECORD_ID_ATTRIBUTE } from '@/helpers'
import { XMLNS_DEFAULT_NAMESPACE, XMLNS_DEV_NAMESPACE, runTestCases } from '@/test'
import { createTestProject } from '@/test/create-test-dialecte'

import type { Transaction } from '@/document'
import type { DialecteError } from '@/errors'
import type { ActParams, ActResult, BaseXmlTestCase, TestCases, TestDialecteConfig } from '@/test'

const SIMPLE_XML = /* xml */ `
	<Root>
		<A aA="a1" bA="hello" />
	</Root>
`

describe('Document.transaction — progress forceClear', () => {
	const projects: Array<{ destroy: () => Promise<void> }> = []

	afterEach(async () => {
		for (const p of projects) await p.destroy()
		projects.length = 0
	})

	it('forceClear()s progress even when the callback left an unbalanced plan() on a SUCCESSFUL commit', async () => {
		const { project, source } = await createTestProject({ sourceXml: SIMPLE_XML })
		projects.push(project)

		const [root] = await source.document.query.getRecordsByTagName('Root')
		await source.document.transaction(async (tx) => {
			tx.progress.plan({ steps: 5, label: 'Working' }) // never closed by endPlan() — commit still succeeds
			await tx.addChild(root, { tagName: 'A', attributes: { aA: 'a2', bA: 'x' } })
		})

		expect(source.document.state.progress).toBeNull()
	})

	it('does not affect a later, unrelated transaction on the same document', async () => {
		const { project, source } = await createTestProject({ sourceXml: SIMPLE_XML })
		projects.push(project)

		await expect(
			source.document.transaction(async (tx) => {
				tx.progress.plan({ steps: 1, label: 'Working' })
				throw new Error('boom')
			}),
		).rejects.toThrow()

		const [root] = await source.document.query.getRecordsByTagName('Root')
		await source.document.transaction(async (tx) => {
			await tx.addChild(root, { tagName: 'A', attributes: { aA: 'a2', bA: 'x' } })
		})

		expect(source.document.state.progress).toBeNull()
	})
})

describe('Document — an error thrown inside a transaction', () => {
	const projects: Array<{ destroy: () => Promise<void> }> = []

	afterEach(async () => {
		for (const project of projects) await project.destroy()
		projects.length = 0
	})

	const DIALECT_ERRORS = defineErrors({
		NAME_TAKEN: { code: 'X1001', message: 'The name is already taken' },
	})

	type Thrower = () => never
	const cases: Array<{
		name: string
		thrower: Thrower
		expected: { key: string; meta?: unknown; detail: string }
	}> = [
		{
			name: 'a structured error → the caller and doc.state.error get it as it is: its key, its data',
			thrower: () =>
				throwDialecteError(DIALECT_ERRORS.NAME_TAKEN, {
					detail: 'name "n1" is already taken',
					meta: { name: 'n1' },
				}),
			expected: {
				key: 'NAME_TAKEN',
				meta: { name: 'n1' },
				detail: 'name "n1" is already taken',
			},
		},
		{
			name: 'any other error → reported as unknown, its message kept as detail',
			thrower: () => {
				throw new Error('boom')
			},
			expected: { key: 'UNKNOWN', meta: undefined, detail: 'boom' },
		},
	]

	for (const run of ['transaction', 'prepare'] as const) {
		it.each(cases)(`${run}: $name`, async ({ thrower, expected }) => {
			const { project, source } = await createTestProject({ sourceXml: SIMPLE_XML })
			projects.push(project)

			const failed =
				run === 'transaction'
					? source.document.transaction(async () => thrower())
					: source.document.prepare(async () => thrower())
			const thrown = await failed.then(
				() => undefined,
				(error: unknown) => error,
			)

			expect({
				thrown: pickReported(toDialecteError(thrown)),
				lastError: pickReported(source.document.state.error),
			}).toEqual({ thrown: expected, lastError: expected })
		})
	}
})

describe('Document — a transaction that throws after staging writes', () => {
	const ns = `${XMLNS_DEFAULT_NAMESPACE} ${XMLNS_DEV_NAMESPACE}`
	const customId = CUSTOM_RECORD_ID_ATTRIBUTE

	type Stage = (tx: Transaction<TestDialecteConfig>) => Promise<unknown>
	type TestCase = BaseXmlTestCase & {
		run: 'transaction' | 'prepare'
		/** Staged by the failing call, then committed by the next transaction. */
		stage: Stage
	}

	function addAa2(tx: Transaction<TestDialecteConfig>) {
		return tx.addChild(
			{ tagName: 'A', id: 'a1' },
			{ tagName: 'AA_2', attributes: { aAA_2: 'added' } },
		)
	}

	function updateBa(tx: Transaction<TestDialecteConfig>) {
		return tx.update({ tagName: 'A', id: 'a1' }, { attributes: { bA: 'after' } })
	}

	function deleteAa2(tx: Transaction<TestDialecteConfig>) {
		return tx.delete({ tagName: 'AA_2', id: 'aa2-deleted' })
	}

	function stageThenThrow(params: { stage: Stage }) {
		return async function stagedThenFailing(tx: Transaction<TestDialecteConfig>): Promise<void> {
			await params.stage(tx)
			throw new Error('boom')
		}
	}

	const testCases: TestCases<TestCase> = {
		'transaction: an add staged, then a throw → document unchanged; the next transaction adds it once':
			{
				sourceXml: /* xml */ `
					<Root ${ns}>
						<A ${customId}="a1" aA="x">
							<AA_1 aAA_1="kept" />
							<!-- no AA_2 yet -->
						</A>
					</Root>
				`,
				run: 'transaction',
				stage: addAa2,
				expectedQueries: ['//default:A[@aA="x"]/default:AA_2[@aAA_2="added"]'],
				unexpectedQueries: ['//default:A/default:AA_2[2]'],
			},
		'transaction: an update staged, then a throw → document unchanged; the next transaction updates it':
			{
				sourceXml: /* xml */ `
					<Root ${ns}>
						<A ${customId}="a1" aA="x" bA="before">
							<AA_1 aAA_1="kept" />
						</A>
					</Root>
				`,
				run: 'transaction',
				stage: updateBa,
				expectedQueries: ['//default:A[@aA="x"][@bA="after"]'],
				unexpectedQueries: ['//default:A[@bA="before"]'],
			},
		'transaction: a delete staged, then a throw → document unchanged; the next transaction deletes it':
			{
				sourceXml: /* xml */ `
					<Root ${ns}>
						<A aA="x">
							<AA_1 aAA_1="kept" />
							<!-- AA_2 deleted by the next transaction -->
							<AA_2 ${customId}="aa2-deleted" aAA_2="deleted" />
						</A>
					</Root>
				`,
				run: 'transaction',
				stage: deleteAa2,
				expectedQueries: ['//default:A[@aA="x"]/default:AA_1[@aAA_1="kept"]'],
				unexpectedQueries: ['//default:AA_2'],
			},
		'prepare: an add staged, then a throw → document unchanged; the next transaction adds it once':
			{
				sourceXml: /* xml */ `
					<Root ${ns}>
						<A ${customId}="a1" aA="x">
							<AA_1 aAA_1="kept" />
							<!-- no AA_2 yet -->
						</A>
					</Root>
				`,
				run: 'prepare',
				stage: addAa2,
				expectedQueries: ['//default:A[@aA="x"]/default:AA_2[@aAA_2="added"]'],
				unexpectedQueries: ['//default:A/default:AA_2[2]'],
			},
		'prepare: an update staged, then a throw → document unchanged; the next transaction updates it':
			{
				sourceXml: /* xml */ `
					<Root ${ns}>
						<A ${customId}="a1" aA="x" bA="before">
							<AA_1 aAA_1="kept" />
						</A>
					</Root>
				`,
				run: 'prepare',
				stage: updateBa,
				expectedQueries: ['//default:A[@aA="x"][@bA="after"]'],
				unexpectedQueries: ['//default:A[@bA="before"]'],
			},
		'prepare: a delete staged, then a throw → document unchanged; the next transaction deletes it':
			{
				sourceXml: /* xml */ `
					<Root ${ns}>
						<A aA="x">
							<AA_1 aAA_1="kept" />
							<!-- AA_2 deleted by the next transaction -->
							<AA_2 ${customId}="aa2-deleted" aAA_2="deleted" />
						</A>
					</Root>
				`,
				run: 'prepare',
				stage: deleteAa2,
				expectedQueries: ['//default:A[@aA="x"]/default:AA_1[@aAA_1="kept"]'],
				unexpectedQueries: ['//default:AA_2'],
			},
	}

	const expectedReport = { key: 'UNKNOWN', meta: undefined, detail: 'boom' }

	async function act({
		testCase,
		source,
	}: ActParams<TestDialecteConfig, TestCase>): Promise<ActResult> {
		const before = await source.query.getSnapshot({ as: 'xml' })

		const failing = stageThenThrow({ stage: testCase.stage })
		const failed =
			testCase.run === 'transaction' ? source.transaction(failing) : source.prepare(failing)
		const thrown = await failed.then(
			() => undefined,
			(error: unknown) => error,
		)
		const after = await source.query.getSnapshot({ as: 'xml' })

		expect({
			thrown: pickReported(toDialecteError(thrown)),
			lastError: pickReported(source.state.error),
			after,
		}).toEqual({ thrown: expectedReport, lastError: expectedReport, after: before })

		await source.transaction(testCase.stage)
		expect(source.state.error).toBeNull()
		return { assertOn: 'source' }
	}

	runTestCases.withExport({ testCases, act })
})

describe('Document — a prepared change whose commit fails', () => {
	const projects: Array<{ destroy: () => Promise<void> }> = []

	afterEach(async () => {
		for (const project of projects) await project.destroy()
		projects.length = 0
	})

	it('the store is closed → the caller and doc.state.error get STORE_CLOSED', async () => {
		const { project, source } = await createTestProject({ sourceXml: SIMPLE_XML })
		projects.push(project)

		const [root] = await source.document.query.getRecordsByTagName('Root')
		const prepared = await source.document.prepare(async (tx) => {
			await tx.addChild(root, { tagName: 'A', attributes: { aA: 'a2', bA: 'x' } })
		})
		source.document.close()

		const thrown = await prepared.commit().then(
			() => undefined,
			(error: unknown) => error,
		)

		const expected = { key: 'STORE_CLOSED' }
		expect({
			thrown: { key: toDialecteError(thrown)?.key },
			lastError: { key: source.document.state.error?.key },
		}).toEqual({ thrown: expected, lastError: expected })
	})
})

describe('Document — the method an error that is not structured reports', () => {
	const projects: Array<{ destroy: () => Promise<void> }> = []

	afterEach(async () => {
		for (const project of projects) await project.destroy()
		projects.length = 0
	})

	it.each([
		{ run: 'transaction', expectedMethod: 'Document.transaction' },
		{ run: 'prepare', expectedMethod: 'Document.prepare' },
	] as const)(
		'$run → $expectedMethod, not the helper that wraps it',
		async ({ run, expectedMethod }) => {
			const { project, source } = await createTestProject({ sourceXml: SIMPLE_XML })
			projects.push(project)

			const failed =
				run === 'transaction'
					? source.document.transaction(async () => {
							throw new Error('boom')
						})
					: source.document.prepare(async () => {
							throw new Error('boom')
						})
			const thrown = await failed.then(
				() => undefined,
				(error: unknown) => error,
			)

			expect(toDialecteError(thrown)?.method).toMatch(new RegExp(`::${expectedMethod}$`))
		},
	)
})

function pickReported(error: DialecteError | null | undefined): {
	key?: string
	meta?: unknown
	detail?: string
} {
	return { key: error?.key, meta: error?.meta, detail: error?.detail }
}
