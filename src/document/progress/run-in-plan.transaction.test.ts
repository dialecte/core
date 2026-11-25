import { createProgressReporter } from './create-progress-reporter'

import { describe, expect, it } from 'vitest'

import { commitTransaction } from '@/document/transaction/commit/commit'
import { InMemoryStore } from '@/store'
import { TEST_DIALECTE_CONFIG, createTestProject, createTestRecord } from '@/test'

import type { DocumentProgress } from './progress.types'
import type { DocumentState } from '@/document/types'
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

function copyOf(progress: DocumentProgress): DocumentProgress {
	return progress && { ...progress, step: progress.step && { ...progress.step } }
}

describe('an extension op running its plan through tx.progress.runInPlan, a nested deepClone throwing inside it', () => {
	it('the error caught by the caller of the op -> the bar shows what it showed before the op', async () => {
		const { source } = await createTestProject({ sourceXml: SOURCE_XML, hooks: THROW_AT_AA_1 })
		const document = source.document
		const [root] = await document.query.getRecordsByTagName('Root')
		const [parent] = await document.query.getRecordsByTagName('A')
		let before: DocumentProgress = null
		let after: DocumentProgress = null
		let caught: unknown

		await document.transaction(async (tx) => {
			tx.progress.plan({ steps: 2, label: 'Working' })
			tx.progress.nextStep()
			const tree = await tx.getTree(parent)
			if (!tree) throw new Error('tree required')
			before = copyOf(document.state.progress)
			caught = await tx.progress
				.runInPlan({
					plan: { steps: 2, label: 'Applying' },
					run: async () => {
						tx.progress.nextStep('Cloning')
						await tx.deepClone(root, tree)
					},
				})
				.catch((error: unknown) => error)
			after = copyOf(document.state.progress)
		})

		expect(caught).toBeInstanceOf(Error)
		expect((caught as Error).message).toContain(CLONE_FAILURE)
		expect(after).toEqual(before)
		expect(document.state.progress).toBeNull()
	})

	it('the error not caught -> the transaction throws the clone error, progress null', async () => {
		const { source } = await createTestProject({ sourceXml: SOURCE_XML, hooks: THROW_AT_AA_1 })
		const document = source.document
		const [root] = await document.query.getRecordsByTagName('Root')
		const [parent] = await document.query.getRecordsByTagName('A')

		await expect(
			document.transaction(async (tx) => {
				const tree = await tx.getTree(parent)
				if (!tree) throw new Error('tree required')
				await tx.progress.runInPlan({
					plan: { steps: 2, label: 'Applying' },
					run: async () => {
						tx.progress.nextStep('Cloning')
						await tx.deepClone(root, tree)
					},
				})
			}),
		).rejects.toThrow(CLONE_FAILURE)

		expect(document.state.progress).toBeNull()
	})
})

describe('progress after a successful commit', () => {
	it('the commit frame closed under an open frame -> at the close a subscriber sees lastUpdate set and loading still true', async () => {
		const state: DocumentState = {
			loading: false,
			error: null,
			progress: null,
			history: [],
			lastUpdate: null,
		}
		const seenAtEachEvent: {
			loading: boolean
			lastUpdate: number | null
			progress: DocumentProgress
		}[] = []
		const progress = createProgressReporter(state, () => {
			seenAtEachEvent.push({
				loading: state.loading,
				lastUpdate: state.lastUpdate,
				progress: copyOf(state.progress),
			})
		})
		const store = new InMemoryStore(`commit-order-${crypto.randomUUID()}`, {
			runtime: STORE_RUNTIME,
		})
		// the store writes both records, reporting each, and answers a version
		store.commit = async function acceptAll({ onProgress }) {
			onProgress(1, 2)
			onProgress(2, 2)
			return { version: { engineId: 'engine-a', count: 1 } }
		}
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
		).resolves.toMatchObject({ changes: expect.anything() })

		const atClose = seenAtEachEvent.at(-1)
		expect(atClose?.progress).toEqual(before)
		expect(atClose?.loading).toBe(true)
		expect(atClose?.lastUpdate).not.toBeNull()
	})
})
