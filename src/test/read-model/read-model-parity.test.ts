import { writeAround } from './bypass-write'
import { expectExposed } from './expect-exposed'
import { expectSnapshot } from './expect-snapshot'
import { waitForChange } from './heard-change'
import { runReadModelCases } from './run-read-model-cases'
import { answerUncached } from './uncached-answer'
import { createVersionTrail } from './version-trail'

import { expect } from 'vitest'

import { CUSTOM_RECORD_ID_ATTRIBUTE } from '@/helpers'
import { COMMIT_CHANGES_MAX } from '@/project/project.constants'
import { SWITCH_CONFIG, SWITCH_DIALECTE_ID, SWITCH_STORAGES } from '@/project/store-switch.fixtures'
import { XMLNS_DEFAULT_NAMESPACE, XMLNS_DEV_NAMESPACE } from '@/test/constant'
import { SILENCE_WAIT_MS } from '@/test/test-timing.constants'

import type { ReadModelContext, VersionTrail } from './read-model-harness.types'
import type { Query } from '@/document/query/main'
import type { AnyDialecteConfig, AnyRawRecord } from '@/types'

// Today's read caches against the uncached path, on every store: the read scope of one verb call and the transaction
// read cache. A heard change is seen at the next read; a change no one tells the reader is a known exposure, pinned as
// the stale answer it gives.

const customId = CUSTOM_RECORD_ID_ATTRIBUTE

const SOURCE_XML = /* xml */ `
	<Root ${XMLNS_DEFAULT_NAMESPACE} ${XMLNS_DEV_NAMESPACE} ${customId}="root">
		<B ${customId}="b" aB="before" />
	</Root>
`

const B_REF = { tagName: 'B', id: 'b' } as const

function readB(query: Query<AnyDialecteConfig>): Promise<string> {
	return query.getAttribute(B_REF, { name: 'aB' })
}

/** The trail of B's `aB` as the store holds it, its first point recorded. */
async function trailOf(context: ReadModelContext): Promise<VersionTrail<string>> {
	const trail = createVersionTrail({
		answer: function uncachedB() {
			return answerUncached({
				store: context.around,
				config: context.config,
				documentId: context.documentId,
				read: readB,
			})
		},
	})
	await trail.record()
	return trail
}

/** Settles once the reader heard its next change. */
function heard(context: ReadModelContext): Promise<void> {
	return waitForChange({ project: context.reader, documentId: context.documentId })
}

/** The writer commits B's `aB` = `value` with more created records than a commit tells: its change is unknown. */
async function commitBOverTheCap(params: {
	context: ReadModelContext
	value: string
}): Promise<void> {
	const { context, value } = params
	await context.writer.openDocument(context.documentId).transaction(async function writeMany(tx) {
		await tx.update(B_REF, { attributes: { aB: value } })
		for (let index = 0; index <= COMMIT_CHANGES_MAX; index++) {
			await tx.addChild({ tagName: 'Root', id: 'root' }, { tagName: 'C' })
		}
	})
}

/** The reader's next verb call answers the newest point of the trail. */
async function expectNextCallFresh(params: {
	context: ReadModelContext
	trail: VersionTrail<string>
}) {
	const { context, trail } = params
	const next = await readB(context.reader.openDocument(context.documentId).query)
	expect(next).toBe(trail.answers.at(-1))
}

/** The writer commits B's `aB` = `value`. */
async function commitB(params: { context: ReadModelContext; value: string }): Promise<void> {
	const { context, value } = params
	await context.writer.openDocument(context.documentId).transaction(async function writeB(tx) {
		await tx.update(B_REF, { attributes: { aB: value } })
	})
}

/** B as stored, `aB` set to `value`: what a write around the projects puts. */
async function bWith(params: { context: ReadModelContext; value: string }): Promise<AnyRawRecord> {
	const { context, value } = params
	const stored = await context.around.get('b', context.documentId)
	if (!stored) throw new Error('the source holds B')
	const others = stored.attributes.filter((attribute) => attribute.name !== 'aB')
	return { ...stored, attributes: [...others, { name: 'aB', value }] }
}

function silence(): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, SILENCE_WAIT_MS))
}

runReadModelCases({
	title: 'read model - today’s caches against the uncached path',
	storages: SWITCH_STORAGES,
	config: SWITCH_CONFIG,
	dialecteId: SWITCH_DIALECTE_ID,
	sourceXml: SOURCE_XML,
	cases: [
		{
			title: 'a commit heard between two verb calls → the second call answers it',
			act: async function betweenCalls(context) {
				const trail = await trailOf(context)
				const query = context.reader.openDocument(context.documentId).query
				await readB(query)
				const told = heard(context)
				await commitB({ context, value: 'after' })
				await told
				await trail.record()
				const answer = await readB(context.reader.openDocument(context.documentId).query)
				expect(answer).toBe(trail.answers.at(-1))
			},
		},
		{
			title:
				'a commit heard while a verb call reads → a moment of the call, the next call answers it',
			act: async function whileACallReads(context) {
				const trail = await trailOf(context)
				const member =
					typeof context.gate.store.readVersioned === 'function' ? 'readVersioned' : 'get'
				const held = context.gate.holdAnswer({ member })
				const answer = readB(context.reader.openDocument(context.documentId).query)
				await held.reached
				const told = heard(context)
				await commitB({ context, value: 'after' })
				await told
				await trail.record()
				held.release()
				const answered = await answer
				// the answer was read before the change and comes back after it was heard: the old one
				expect(answered).toBe(trail.answers[0])
				expectSnapshot({ answer: answered, trail, from: 0 })
				await expectNextCallFresh({ context, trail })
			},
		},
		{
			title: 'a commit heard between two reads of a transaction → the second read answers it',
			act: async function betweenTransactionReads(context) {
				const trail = await trailOf(context)
				const answer = await context.reader
					.openDocument(context.documentId)
					.transaction(async function readTwice(tx) {
						await readB(tx)
						const told = heard(context)
						await commitB({ context, value: 'after' })
						await told
						await trail.record()
						return readB(tx)
					})
				expect(answer).toBe(trail.answers.at(-1))
			},
		},
		{
			title:
				'a commit heard while a transaction reads → a moment of the transaction, the next read answers it',
			act: async function whileATransactionReads(context) {
				const trail = await trailOf(context)
				const answer = await context.reader
					.openDocument(context.documentId)
					.transaction(async function readAcross(tx) {
						const held = context.gate.holdAnswer({ member: 'get' })
						const read = readB(tx)
						await held.reached
						const told = heard(context)
						await commitB({ context, value: 'after' })
						await told
						await trail.record()
						held.release()
						const inFlight = await read
						const next = await readB(tx)
						return { inFlight, next }
					})
				// the answer was read before the change and comes back after it was heard: the old one
				expect(answer.inFlight).toBe(trail.answers[0])
				expectSnapshot({ answer: answer.inFlight, trail, from: 0 })
				expectSnapshot({ answer: answer.next, trail, from: 0, notBefore: answer.inFlight })
				expect(answer.next).toBe(trail.answers.at(-1))
			},
		},
		{
			title: 'a commit message lost between two reads of a transaction → the record before it',
			announces: false,
			act: async function lostMessage(context) {
				const trail = await trailOf(context)
				const dropped = context.channel.drop({ type: 'commit' })
				const answer = await context.reader
					.openDocument(context.documentId)
					.transaction(async function readTwice(tx) {
						await readB(tx)
						await commitB({ context, value: 'after' })
						await dropped.reached
						await trail.record()
						return readB(tx)
					})
				expectExposed({ answer, trail, staleAt: 0, because: 'a lost message is never noticed' })
			},
		},
		{
			title:
				'a write around the projects between two reads of a transaction → the record before it',
			announces: false,
			act: async function aroundUntold(context) {
				const trail = await trailOf(context)
				const answer = await context.reader
					.openDocument(context.documentId)
					.transaction(async function readTwice(tx) {
						await readB(tx)
						const around = await bWith({ context, value: 'around' })
						await writeAround({
							store: context.around,
							documentId: context.documentId,
							updates: [around],
						})
						await silence()
						await trail.record()
						return readB(tx)
					})
				expectExposed({
					answer,
					trail,
					staleAt: 0,
					because: 'a write no project tells is never noticed',
				})
			},
		},
		{
			title:
				'a write around the projects, its notice heard between two reads of a transaction → the second read answers it',
			announces: true,
			act: async function aroundAnnounced(context) {
				const trail = await trailOf(context)
				const answer = await context.reader
					.openDocument(context.documentId)
					.transaction(async function readTwice(tx) {
						await readB(tx)
						const told = heard(context)
						const around = await bWith({ context, value: 'around' })
						await writeAround({
							store: context.around,
							documentId: context.documentId,
							updates: [around],
						})
						await told
						await trail.record()
						return readB(tx)
					})
				expect(answer).toBe(trail.answers.at(-1))
			},
		},
		{
			title:
				'a commit’s notice not folded yet between two reads of a transaction → the record before it',
			announces: true,
			act: async function lateNotice(context) {
				const trail = await trailOf(context)
				const notices = context.gate.holdNotices()
				const answer = await context.reader
					.openDocument(context.documentId)
					.transaction(async function readTwice(tx) {
						await readB(tx)
						await commitB({ context, value: 'after' })
						await notices.reached
						await trail.record()
						return readB(tx)
					})
				context.gate.releaseNotices()
				expectExposed({ answer, trail, staleAt: 0, because: 'a notice not folded yet is not seen' })
			},
		},
		{
			title:
				'a write around the projects while a verb call reads → a moment of the call, the next call answers it once heard',
			act: async function aroundWhileACallReads(context) {
				const trail = await trailOf(context)
				const member =
					typeof context.gate.store.readVersioned === 'function' ? 'readVersioned' : 'get'
				const held = context.gate.holdAnswer({ member })
				const answer = readB(context.reader.openDocument(context.documentId).query)
				await held.reached
				const told = context.announces ? heard(context) : Promise.resolve()
				const around = await bWith({ context, value: 'around' })
				await writeAround({
					store: context.around,
					documentId: context.documentId,
					updates: [around],
				})
				await told
				await trail.record()
				held.release()
				const answered = await answer
				// the answer was read before the change and comes back after it was heard: the old one
				expect(answered).toBe(trail.answers[0])
				expectSnapshot({ answer: answered, trail, from: 0 })
				await expectNextCallFresh({ context, trail })
			},
		},
		{
			title:
				'a commit’s notice held while a verb call reads → a moment of the call, the next call answers it once folded',
			announces: true,
			act: async function lateNoticeWhileACallReads(context) {
				const trail = await trailOf(context)
				const held = context.gate.holdAnswer({ member: 'readVersioned' })
				const notices = context.gate.holdNotices()
				const answer = readB(context.reader.openDocument(context.documentId).query)
				await held.reached
				await commitB({ context, value: 'after' })
				await notices.reached
				await trail.record()
				held.release()
				const answered = await answer
				// the answer was read before the change and comes back after it was heard: the old one
				expect(answered).toBe(trail.answers[0])
				expectSnapshot({ answer: answered, trail, from: 0 })
				const told = heard(context)
				context.gate.releaseNotices()
				await told
				await expectNextCallFresh({ context, trail })
			},
		},
		{
			title:
				'a commit too large to tell its changes heard between two verb calls → the second call answers it',
			act: async function unknownBetweenCalls(context) {
				const trail = await trailOf(context)
				await readB(context.reader.openDocument(context.documentId).query)
				const told = heard(context)
				await commitBOverTheCap({ context, value: 'after' })
				await told
				await trail.record()
				await expectNextCallFresh({ context, trail })
			},
		},
		{
			title:
				'a commit too large to tell its changes heard between two reads of a transaction → the second read answers it',
			act: async function unknownBetweenTransactionReads(context) {
				const trail = await trailOf(context)
				const answer = await context.reader
					.openDocument(context.documentId)
					.transaction(async function readTwice(tx) {
						await readB(tx)
						const told = heard(context)
						await commitBOverTheCap({ context, value: 'after' })
						await told
						await trail.record()
						return readB(tx)
					})
				expect(answer).toBe(trail.answers.at(-1))
			},
		},
		{
			title: 'a write around the projects → no message reaches the reader, its read epoch stays',
			announces: false,
			act: async function aroundTellsNothing(context) {
				const heardMessages: string[] = []
				const listener = context.reader.createChannel()
				listener.onmessage = function keep(event: MessageEvent<{ type: string }>) {
					heardMessages.push(event.data.type)
				}
				const internals = context.reader as unknown as {
					readEpochOf: (documentId: string) => number
				}
				const epochBefore = internals.readEpochOf(context.documentId)
				const around = await bWith({ context, value: 'around' })
				await writeAround({
					store: context.around,
					documentId: context.documentId,
					updates: [around],
				})
				await silence()
				listener.close()
				expect({ heardMessages, epochAfter: internals.readEpochOf(context.documentId) }).toEqual({
					heardMessages: [],
					epochAfter: epochBefore,
				})
			},
		},
	],
})
