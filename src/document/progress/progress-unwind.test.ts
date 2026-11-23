import { createProgressReporter } from './create-progress-reporter'

import { describe, expect, it } from 'vitest'

import { commitTransaction } from '@/document/transaction/commit/commit'
import { InMemoryStore } from '@/store'
import { TEST_DIALECTE_CONFIG, createTestProject, createTestRecord } from '@/test'

import type { DocumentProgress } from './progress.types'
import type { DocumentState } from '@/document/types'
import type { Store } from '@/store'
import type { TestDialecteConfig } from '@/test'
import type { Operation, TransactionHooks } from '@/types'

const SOURCE_XML = /* xml */ `
	<Root>
		<A aA="parent">
			<AA_1 aAA_1="one" />
			<AA_1 aAA_1="two" />
		</A>
	</Root>
`

const CLONE_FAILURE = 'clone refused'

/** A clone that stages A, then throws at its first AA_1 child. */
const THROW_AT_AA_1: TransactionHooks<TestDialecteConfig> = {
	beforeClone: ({ record }) => {
		if (record.tagName === 'AA_1') throw new Error(CLONE_FAILURE)
		return { shouldBeCloned: true, transformedRecord: record }
	},
}

const STORE_RUNTIME = { configs: { default: TEST_DIALECTE_CONFIG }, defaultConfigKey: 'default' }

/** A real in-memory store whose every commit reports its first of two writes, then is refused with `failure`. */
function storeRefusingCommits(params: { failure: Error }): Store {
	const store = new InMemoryStore(`refusing-commits-${crypto.randomUUID()}`, {
		runtime: STORE_RUNTIME,
	})
	store.commit = async function refuseHalfway({ onProgress }) {
		onProgress(1, 2)
		throw params.failure
	}
	return store
}

function copyOf(progress: DocumentProgress): DocumentProgress {
	return progress && { ...progress, step: progress.step && { ...progress.step } }
}

describe('progress after a nested op throws', () => {
	describe('a deepClone that throws under open frames, caught by the body -> the bar shows what it showed before the clone', () => {
		type TestCase = { framesBefore: number }
		const testCases: Record<string, TestCase> = {
			'under 1 frame': { framesBefore: 1 },
			'under 2 frames': { framesBefore: 2 },
			'under 3 frames': { framesBefore: 3 },
		}
		for (const [description, { framesBefore }] of Object.entries(testCases)) {
			it(description, async () => {
				const { source } = await createTestProject({ sourceXml: SOURCE_XML, hooks: THROW_AT_AA_1 })
				const document = source.document
				const [root] = await document.query.getRecordsByTagName('Root')
				const [a] = await document.query.getRecordsByTagName('A')
				let before: DocumentProgress = null
				let after: DocumentProgress = null

				await document.transaction(async (tx) => {
					for (let level = 1; level <= framesBefore; level++) {
						tx.progress.plan({ steps: 2, label: `L${level}` })
						tx.progress.nextStep()
					}
					const tree = await tx.getTree(a)
					if (!tree) throw new Error('tree required')
					before = copyOf(document.state.progress)
					await expect(tx.deepClone(root, tree)).rejects.toThrow(CLONE_FAILURE)
					after = copyOf(document.state.progress)
					for (let level = 1; level <= framesBefore; level++) tx.progress.endPlan()
				})

				expect(after).toEqual(before)
				expect(document.state.progress).toBeNull()
			})
		}
	})

	it('a transaction body that throws after a successful deepClone -> progress null, the error thrown', async () => {
		const { source } = await createTestProject({ sourceXml: SOURCE_XML })
		const document = source.document
		const [root] = await document.query.getRecordsByTagName('Root')
		const [a] = await document.query.getRecordsByTagName('A')

		await expect(
			document.transaction(async (tx) => {
				tx.progress.plan({ steps: 2, label: 'Working' })
				const tree = await tx.getTree(a)
				if (!tree) throw new Error('tree required')
				await tx.deepClone(root, tree)
				throw new Error('after the clone')
			}),
		).rejects.toThrow('after the clone')

		expect(document.state.progress).toBeNull()
	})

	it('successful nested ops -> the same progress values, in the same order, as before this fix', async () => {
		const { source } = await createTestProject({ sourceXml: SOURCE_XML })
		const document = source.document
		const [root] = await document.query.getRecordsByTagName('Root')
		const [a] = await document.query.getRecordsByTagName('A')
		const seen: DocumentProgress[] = []
		let recording = false
		document.subscribe(() => {
			if (recording) seen.push(copyOf(document.state.progress))
		})

		await document.transaction(async (tx) => {
			recording = true
			tx.progress.plan({ steps: 2, label: 'Working' })
			tx.progress.nextStep('Cloning')
			const tree = await tx.getTree(a)
			if (!tree) throw new Error('tree required')
			await tx.deepClone(root, tree)
			tx.progress.nextStep('Cloning again')
			await tx.deepClone(root, tree)
			recording = false
		})

		expect(seen).toEqual([
			{ current: 0, total: 2, label: 'Working', step: null },
			{ current: 0, total: 2, label: 'Cloning', step: null },
			{ current: 0, total: 2, label: 'Cloning', step: { current: 0, total: 3 } },
			{ current: 0, total: 2, label: 'Cloning', step: { current: 0, total: 3 } },
			{ current: 0, total: 2, label: 'Cloning', step: { current: 1, total: 3 } },
			{ current: 0, total: 2, label: 'Cloning', step: { current: 2, total: 3 } },
			{ current: 0, total: 2, label: 'Cloning', step: null },
			{ current: 1, total: 2, label: 'Cloning again', step: null },
			{ current: 1, total: 2, label: 'Cloning again', step: { current: 0, total: 3 } },
			{ current: 1, total: 2, label: 'Cloning again', step: { current: 0, total: 3 } },
			{ current: 1, total: 2, label: 'Cloning again', step: { current: 1, total: 3 } },
			{ current: 1, total: 2, label: 'Cloning again', step: { current: 2, total: 3 } },
			{ current: 1, total: 2, label: 'Cloning again', step: null },
		])
		expect(document.state.progress).toBeNull()
	})
})

describe('progress after a commit throws', () => {
	it('a store that throws in the middle of the commit plan, under an open frame -> the commit frame popped, the open frame shown as before', async () => {
		const state: DocumentState = {
			loading: false,
			error: null,
			progress: null,
			history: [],
			lastUpdate: null,
		}
		const progress = createProgressReporter(state)
		const failure = new Error('store failure')
		const store = storeRefusingCommits({ failure })
		const operations: Operation<TestDialecteConfig>[] = ['r1', 'r2'].map((id) => ({
			status: 'created',
			oldRecord: undefined,
			newRecord: createTestRecord({ record: { tagName: 'A', id } }),
		}))
		progress.plan({ steps: 2, label: 'Applying' })
		progress.nextStep()
		const before = copyOf(state.progress)

		await expect(
			commitTransaction({
				writeId: 'w-1',
				stagedOperations: operations,
				store,
				documentId: 'doc-1',
				documentState: state,
				progress,
			}),
		).rejects.toBe(failure)

		expect(state.progress).toEqual(before)
	})
})

describe('progress after a prepare', () => {
	it('a prepare body that throws with plans open -> progress null, the error thrown', async () => {
		const { source } = await createTestProject({ sourceXml: SOURCE_XML })
		const document = source.document

		await expect(
			document.prepare(async (tx) => {
				tx.progress.plan({ steps: 3, label: 'Preparing' })
				tx.progress.nextStep()
				tx.progress.plan({ steps: 2, label: 'Inner' })
				throw new Error('prepare failed')
			}),
		).rejects.toThrow('prepare failed')

		expect(document.state.progress).toBeNull()
	})

	it('a prepare body that throws after a successful deepClone -> progress null', async () => {
		const { source } = await createTestProject({ sourceXml: SOURCE_XML })
		const document = source.document
		const [root] = await document.query.getRecordsByTagName('Root')
		const [a] = await document.query.getRecordsByTagName('A')

		await expect(
			document.prepare(async (tx) => {
				tx.progress.plan({ steps: 2, label: 'Preparing' })
				const tree = await tx.getTree(a)
				if (!tree) throw new Error('tree required')
				await tx.deepClone(root, tree)
				throw new Error('after the clone')
			}),
		).rejects.toThrow('after the clone')

		expect(document.state.progress).toBeNull()
	})

	it('a prepare body whose deepClone throws, uncaught -> progress null, the clone error thrown', async () => {
		const { source } = await createTestProject({ sourceXml: SOURCE_XML, hooks: THROW_AT_AA_1 })
		const document = source.document
		const [root] = await document.query.getRecordsByTagName('Root')
		const [a] = await document.query.getRecordsByTagName('A')

		await expect(
			document.prepare(async (tx) => {
				const tree = await tx.getTree(a)
				if (!tree) throw new Error('tree required')
				await tx.deepClone(root, tree)
			}),
		).rejects.toThrow(CLONE_FAILURE)

		expect(document.state.progress).toBeNull()
	})

	it('a prepared commit after a body that left its plan open -> progress null after the commit', async () => {
		const { source } = await createTestProject({ sourceXml: SOURCE_XML })
		const document = source.document
		const [root] = await document.query.getRecordsByTagName('Root')

		const prepared = await document.prepare(async (tx) => {
			tx.progress.plan({ steps: 1, label: 'Preparing' })
			await tx.addChild(root, { tagName: 'A', attributes: { aA: 'added' } })
		})
		await expect(prepared.commit()).resolves.toBeUndefined()

		expect(document.state.progress).toBeNull()
	})

	it('a prepared commit whose store write throws, after a body that left its plan open -> progress null, the store error thrown', async () => {
		const { source } = await createTestProject({
			sourceXml: SOURCE_XML,
			storage: {
				type: 'custom',
				store: storeRefusingCommits({ failure: new Error('store refused') }),
			},
		})
		const document = source.document
		const [root] = await document.query.getRecordsByTagName('Root')

		const prepared = await document.prepare(async (tx) => {
			tx.progress.plan({ steps: 1, label: 'Preparing' })
			await tx.addChild(root, { tagName: 'A', attributes: { aA: 'added' } })
		})
		await expect(prepared.commit()).rejects.toThrow('store refused')

		expect(document.state.progress).toBeNull()
	})

	it('a prepare discarded after a body that left its plan open -> progress null', async () => {
		const { source } = await createTestProject({ sourceXml: SOURCE_XML })
		const document = source.document
		const [root] = await document.query.getRecordsByTagName('Root')

		const prepared = await document.prepare(async (tx) => {
			tx.progress.plan({ steps: 1, label: 'Preparing' })
			await tx.addChild(root, { tagName: 'A', attributes: { aA: 'added' } })
		})
		prepared.discard()

		expect(document.state.progress).toBeNull()
	})
})

describe('an extension op closing its own plan in a finally, a nested deepClone throwing inside it', () => {
	it('the error caught inside the body -> the prepare resolves, progress null', async () => {
		const { source } = await createTestProject({ sourceXml: SOURCE_XML, hooks: THROW_AT_AA_1 })
		const document = source.document
		const [root] = await document.query.getRecordsByTagName('Root')
		const [parent] = await document.query.getRecordsByTagName('A')
		let caught: unknown

		const prepared = await document.prepare(async (tx) => {
			tx.progress.plan({ steps: 2, label: 'Applying' })
			try {
				tx.progress.nextStep('Cloning')
				const tree = await tx.getTree(parent)
				if (!tree) throw new Error('tree required')
				await tx.deepClone(root, tree).catch((error: unknown) => {
					caught = error
				})
			} finally {
				tx.progress.endPlan()
			}
		})

		expect(caught).toBeInstanceOf(Error)
		expect(document.state.progress).toBeNull()
		prepared.discard()
	})

	it('the error not caught -> the prepare throws the clone error, progress null', async () => {
		const { source } = await createTestProject({ sourceXml: SOURCE_XML, hooks: THROW_AT_AA_1 })
		const document = source.document
		const [root] = await document.query.getRecordsByTagName('Root')
		const [parent] = await document.query.getRecordsByTagName('A')

		await expect(
			document.prepare(async (tx) => {
				tx.progress.plan({ steps: 2, label: 'Applying' })
				try {
					tx.progress.nextStep('Cloning')
					const tree = await tx.getTree(parent)
					if (!tree) throw new Error('tree required')
					await tx.deepClone(root, tree)
				} finally {
					tx.progress.endPlan()
				}
			}),
		).rejects.toThrow(CLONE_FAILURE)

		expect(document.state.progress).toBeNull()
	})
})
