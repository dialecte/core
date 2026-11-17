import { describeCommitChanges, mergeOperations } from './transaction/commit'

import { describe, expect, onTestFinished, vi } from 'vitest'

import { CUSTOM_RECORD_ID_ATTRIBUTE, toRawRecord } from '@/helpers'
import { COMMIT_CHANGES_MAX } from '@/project/project.constants'
import { XMLNS_DEFAULT_NAMESPACE, XMLNS_DEV_NAMESPACE, runTestCases } from '@/test'

import type { Project } from '@/project'
import type { ProjectChannelMessage } from '@/project/types'
import type { ActParams, BaseXmlTestCase, TestCases, TestDialecteConfig } from '@/test'
import type { AnyDialecteConfig, DialecteHooks, ElementsOf, Operation, RawRecord } from '@/types'

type CommitMessage = Extract<ProjectChannelMessage, { type: 'commit' }>
type Source = ActParams<TestDialecteConfig, BaseXmlTestCase>['source']
type TestTransaction = Parameters<Parameters<Source['transaction']>[0]>[0]
type BeforeCommitParams = Parameters<
	NonNullable<DialecteHooks<TestDialecteConfig>['beforeCommit']>
>[0]

const ns = `${XMLNS_DEFAULT_NAMESPACE} ${XMLNS_DEV_NAMESPACE}`
const customId = CUSTOM_RECORD_ID_ATTRIBUTE

const sourceXml = /* xml */ `
	<Root ${ns} ${customId}="root">
		<A ${customId}="a" aA="kept">
			<AA_1 ${customId}="aa1" aAA_1="one"><AAA_1 ${customId}="aaa1" aAAA_1="abc"/></AA_1>
		</A>
		<B ${customId}="b" />
	</Root>
`

/** Creates an AA_2 under A, updates B, deletes AAA_1 (its parent AA_1 updated). */
async function writeThree(tx: TestTransaction): Promise<void> {
	await tx.addChild({ tagName: 'A', id: 'a' }, { tagName: 'AA_2', attributes: { aAA_2: '5' } })
	await tx.update({ tagName: 'B', id: 'b' }, { attributes: { aB: 'changed' } })
	await tx.delete({ tagName: 'AAA_1', id: 'aaa1' })
}

/** The commits the project's channel tells, in order; its channel closed after the case. */
function commitsHeard(params: { project: Project<AnyDialecteConfig> }): CommitMessage[] {
	const heard: CommitMessage[] = []
	const channel = params.project.createChannel()
	channel.onmessage = function hear(event: MessageEvent<ProjectChannelMessage>) {
		if (event.data.type === 'commit') heard.push(event.data)
	}
	onTestFinished(function closeChannel() {
		channel.close()
	})
	return heard
}

async function firstCommit(params: { heard: CommitMessage[] }): Promise<CommitMessage> {
	await vi.waitFor(function commitHeard() {
		expect(params.heard.length).toBeGreaterThan(0)
	})
	return params.heard[0]!
}

/** The changes as they read when every list is sorted by id: the order a commit's merge gives is not the contract. */
function sortedById(changes: CommitMessage['changes']): CommitMessage['changes'] {
	if ('unknown' in changes) return changes
	return {
		created: [...changes.created].sort(byId),
		updated: [...changes.updated].sort(byId),
		deleted: [...changes.deleted].sort(byId),
	}
}

function byId(left: { id: string }, right: { id: string }): number {
	return left.id.localeCompare(right.id)
}

const createdAA2 = { tagName: 'AA_2', parentId: 'a' }
const expectedThree = {
	created: [createdAA2],
	updated: [
		{ id: 'a', tagName: 'A', parentId: 'root' },
		{ id: 'aa1', tagName: 'AA_1', parentId: 'a' },
		{ id: 'b', tagName: 'B', parentId: 'root' },
	],
	deleted: [{ id: 'aaa1', tagName: 'AAA_1', parentId: 'aa1' }],
}

function withoutCreatedIds(changes: CommitMessage['changes']): unknown {
	if ('unknown' in changes) return changes
	return {
		...changes,
		created: changes.created.map(function withoutId({ tagName, parentId }) {
			return { tagName, parentId }
		}),
	}
}

describe('the commit message carries the commit’s changes', () => {
	const transactionCases: TestCases<BaseXmlTestCase> = {
		'doc.transaction with creates, updates and deletes -> the commit message carries the exact changes':
			{ sourceXml },
	}

	async function actTransaction({
		project,
		source,
	}: ActParams<TestDialecteConfig, BaseXmlTestCase>) {
		const heard = commitsHeard({ project: project as unknown as Project<AnyDialecteConfig> })
		await source.transaction(writeThree)
		const commit = await firstCommit({ heard })
		expect(withoutCreatedIds(sortedById(commit.changes))).toEqual(expectedThree)
	}

	runTestCases.withoutExport({ testCases: transactionCases, act: actTransaction })

	const prepareCases: TestCases<BaseXmlTestCase> = {
		'prepare().commit() -> the same changes as the transaction': { sourceXml },
	}

	async function actPrepare({ project, source }: ActParams<TestDialecteConfig, BaseXmlTestCase>) {
		const heard = commitsHeard({ project: project as unknown as Project<AnyDialecteConfig> })
		const prepared = await source.prepare(writeThree)
		await prepared.commit()
		const commit = await firstCommit({ heard })
		expect(withoutCreatedIds(sortedById(commit.changes))).toEqual(expectedThree)
	}

	runTestCases.withoutExport({ testCases: prepareCases, act: actPrepare })
})

describe('beforeCommit hook writes are in the changes', () => {
	/** Stamps the root's value on every commit: a record no write of the callback touched. */
	async function stampRoot({
		query,
	}: BeforeCommitParams): Promise<Operation<TestDialecteConfig>[]> {
		const tracked = await query.getRoot()
		// any element of the dialecte: the operation's record type
		const root = toRawRecord(tracked) as RawRecord<
			TestDialecteConfig,
			ElementsOf<TestDialecteConfig>
		>
		return [{ status: 'updated', oldRecord: root, newRecord: { ...root, value: 'stamped' } }]
	}
	const hooks = { beforeCommit: stampRoot }

	const testCases: TestCases<BaseXmlTestCase> = {
		'beforeCommit hook writes -> in the changes, equal to the builder over the merged staged operations':
			{
				sourceXml,
			},
	}

	async function act({ project, source }: ActParams<TestDialecteConfig, BaseXmlTestCase>) {
		const heard = commitsHeard({ project: project as unknown as Project<AnyDialecteConfig> })
		const prepared = await source.prepare(writeThree)
		const { creates, updates, deletes } = mergeOperations(prepared.operations)
		const expected = describeCommitChanges({
			creates: creates.map((operation) => operation.newRecord),
			updates: updates.map((operation) => operation.newRecord),
			deletes: deletes.map((operation) => operation.oldRecord),
		})
		await prepared.commit()
		const commit = await firstCommit({ heard })
		expect(commit.changes).toEqual(expected)
		expect(sortedById(commit.changes)).toMatchObject({
			updated: expect.arrayContaining([{ id: 'root', tagName: 'Root', parentId: null }]),
		})
	}

	runTestCases.withoutExport({ testCases, act, hooks })
})

describe('a commit past the cap', () => {
	const testCases: TestCases<BaseXmlTestCase> = {
		'a commit over the cap -> { unknown: true }': { sourceXml },
	}

	async function act({ project, source }: ActParams<TestDialecteConfig, BaseXmlTestCase>) {
		const heard = commitsHeard({ project: project as unknown as Project<AnyDialecteConfig> })
		// COMMIT_CHANGES_MAX creates and A updated: one ref past the cap
		await source.transaction(async (tx) => {
			for (let index = 0; index < COMMIT_CHANGES_MAX; index++) {
				await tx.addChild(
					{ tagName: 'A', id: 'a' },
					{ tagName: 'AA_2', attributes: { aAA_2: String(index) } },
				)
			}
		})
		const commit = await firstCommit({ heard })
		expect(commit.changes).toEqual({ unknown: true })
	}

	runTestCases.withoutExport({ testCases, act })
})

describe('a move between parents is in the changes', () => {
	const moveXml = /* xml */ `
		<Root ${ns} ${customId}="root">
			<A ${customId}="a" aA="kept">
				<AA_1 ${customId}="aa1" aAA_1="one"><AAA_1 ${customId}="aaa1" aAAA_1="abc"/></AA_1>
				<AA_2 ${customId}="aa2" aAA_2="two" />
			</A>
		</Root>
	`
	const moved = { tagName: 'AAA_1', id: 'aaa1' } as const
	const target = { tagName: 'AA_2', id: 'aa2' } as const

	const moveCases: TestCases<BaseXmlTestCase> = {
		'tx.move under another parent -> the moved record (its new parent) and both parents in updated':
			{
				sourceXml: moveXml,
			},
	}

	async function actMove({ project, source }: ActParams<TestDialecteConfig, BaseXmlTestCase>) {
		const heard = commitsHeard({ project: project as unknown as Project<AnyDialecteConfig> })
		await source.transaction(async (tx) => {
			await tx.move(moved, { parent: target })
		})
		const commit = await firstCommit({ heard })
		expect(sortedById(commit.changes)).toEqual({
			created: [],
			updated: [
				{ id: 'aa1', tagName: 'AA_1', parentId: 'a' },
				{ id: 'aa2', tagName: 'AA_2', parentId: 'a' },
				{ id: 'aaa1', tagName: 'AAA_1', parentId: 'aa2' },
			],
			deleted: [],
		})
	}

	runTestCases.withoutExport({ testCases: moveCases, act: actMove })

	const moveDeleteCases: TestCases<BaseXmlTestCase> = {
		'tx.move then delete in one transaction -> deleted with its original parent, both parents updated':
			{
				sourceXml: moveXml,
			},
	}

	async function actMoveDelete({
		project,
		source,
	}: ActParams<TestDialecteConfig, BaseXmlTestCase>) {
		const heard = commitsHeard({ project: project as unknown as Project<AnyDialecteConfig> })
		await source.transaction(async (tx) => {
			await tx.move(moved, { parent: target })
			await tx.delete(moved)
		})
		const commit = await firstCommit({ heard })
		expect(sortedById(commit.changes)).toEqual({
			created: [],
			updated: [
				{ id: 'aa1', tagName: 'AA_1', parentId: 'a' },
				{ id: 'aa2', tagName: 'AA_2', parentId: 'a' },
			],
			deleted: [{ id: 'aaa1', tagName: 'AAA_1', parentId: 'aa1' }],
		})
	}

	runTestCases.withoutExport({ testCases: moveDeleteCases, act: actMoveDelete })
})
