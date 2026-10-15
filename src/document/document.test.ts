import { describe, expect, it, afterEach } from 'vitest'

import { defineErrors, throwDialecteError, toDialecteError } from '@/errors'
import { createTestProject } from '@/test/create-test-dialecte'

import type { DialecteError } from '@/errors'

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

describe('Document — a prepared change whose commit fails', () => {
	const projects: Array<{ destroy: () => Promise<void> }> = []

	afterEach(async () => {
		for (const project of projects) await project.destroy()
		projects.length = 0
	})

	it('the store is closed → the caller and doc.state.error get the store refusal', async () => {
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

		const expected = { key: 'STORE_COMMIT_FAILED' }
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
