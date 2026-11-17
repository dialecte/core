import {
	attributeIndexTablesOf,
	buildAttributeSlice,
	markAttributePairReady,
	readPairStates,
	registerAttributePair,
} from './attribute-index'
import { ATTRIBUTE_PAIR_STATE } from './attribute-index.constants'
import { documentTablesOf } from './registry'

import { yieldToQueue } from '@/utils/yield-to-queue'

import type {
	AttributeBuildContext,
	AttributeIndexBuilder,
	AttributeIndexTables,
	AttributePairBuild,
} from './attribute-index.types'

/**
 * The engine's builds of index pairs: each pair a lookup queued is built in the background, one at a time, never
 * inside a call. A build registers its pair (from then on every write keeps the rows of the records it touches),
 * adds the tag's records in slices - each its own short write, made as the engine's writes are (`write`: after the
 * running import's window is settled), the calls waiting run after every `sliceMs` - and marks it `ready` in the
 * transaction of its last slice. While an import runs (`giveWayTo`), no slice. Each slice checks that the
 * document is the one the build started on, still ready, and its pair still `building`; a removed document ends its
 * builds. A build that fails leaves its pair `building` (looked up by filter) and is not queued again until the
 * engine starts again.
 */
export function createAttributeIndexBuilder(context: AttributeBuildContext): AttributeIndexBuilder {
	const pending = new Map<string, AttributePairBuild>()
	const failed = new Set<string>()
	let running = false

	async function runQueued(): Promise<void> {
		// never inside the call that queued: the builds start once it has answered
		await yieldToQueue()
		try {
			for (const [key, pair] of pending) {
				if (context.isClosed()) break
				try {
					await buildPair({ context, pair })
				} catch {
					failed.add(key)
				} finally {
					pending.delete(key)
				}
			}
		} finally {
			running = false
			if (pending.size > 0 && !context.isClosed()) start()
		}
	}

	function start(): void {
		running = true
		runQueued().catch(leaveForNextStart)
	}

	return {
		queue: function queue({ documentId, tagName, names }) {
			for (const name of names) {
				const key = JSON.stringify([documentId, tagName, name])
				if (pending.has(key) || failed.has(key)) continue
				pending.set(key, { documentId, tagName, name })
			}
			if (!running && pending.size > 0) start()
		},
	}
}

/** One pair registered, then built slice by slice until its last slice marks it `ready`, or its document changed. */
async function buildPair(params: {
	context: AttributeBuildContext
	pair: AttributePairBuild
}): Promise<void> {
	const { context, pair } = params
	const { db, write, isClosed, sliceMs, onStep } = context
	const { tagName, name } = pair
	await untilNoImportRuns({ context })
	if (isClosed()) return
	const tables = readyIndexTablesOf({ context, documentId: pair.documentId })
	if (!tables) return
	let building = false
	write(function registerPair() {
		building =
			registerAttributePair({ db, tables, tagName, name }) === ATTRIBUTE_PAIR_STATE.building
	})
	let afterRow: number | undefined = 0
	let sliceStartedAt = performance.now()
	while (building && afterRow !== undefined) {
		await untilNoImportRuns({ context })
		if (isClosed()) return
		const from: number = afterRow
		write(function addSlice() {
			if (!isStillBuilding({ context, pair, tables })) {
				building = false
				return
			}
			afterRow = buildAttributeSlice({ db, tables, tagName, name, afterRow: from })
			if (afterRow === undefined) markAttributePairReady({ db, tables, tagName, name })
		})
		onStep?.()
		if (performance.now() - sliceStartedAt < sliceMs) continue
		await yieldToQueue()
		sliceStartedAt = performance.now()
	}
}

/** The index tables of the document when it is registered and ready; none otherwise. */
function readyIndexTablesOf(params: {
	context: AttributeBuildContext
	documentId: string
}): AttributeIndexTables | undefined {
	const { context, documentId } = params
	const document = documentTablesOf({ db: context.db, documentId })
	if (!document || document.status !== 'ready') return undefined
	return attributeIndexTablesOf({ seq: document.seq })
}

/** Whether the build's document is still the one it started on, ready, its pair still `building`. */
function isStillBuilding(params: {
	context: AttributeBuildContext
	pair: AttributePairBuild
	tables: AttributeIndexTables
}): boolean {
	const { context, pair, tables } = params
	const current = readyIndexTablesOf({ context, documentId: pair.documentId })
	if (current?.keys !== tables.keys) return false
	const states = readPairStates({
		db: context.db,
		tables,
		tagName: pair.tagName,
		names: [pair.name],
	})
	return states.get(pair.name) === ATTRIBUTE_PAIR_STATE.building
}

/** Once no import runs: a slice never settles an import's window. */
async function untilNoImportRuns(params: { context: AttributeBuildContext }): Promise<void> {
	const { giveWayTo } = params.context
	for (let running = giveWayTo(); running; running = giveWayTo()) {
		await running.catch(leaveForNextStart)
	}
}

/** A build's failure is left: its pair stays `building`, answered by filter, built again at the next start. */
function leaveForNextStart(): void {}
