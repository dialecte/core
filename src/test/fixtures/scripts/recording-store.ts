import { RECORDED_STORE_READS } from './scenario-benchmarks.constants'

import type { ReadLog } from './scenario-benchmarks.types'
import type { Store } from '@/store'

/**
 * The store as it is, with every record its reads answer (`get`, `getMany`, `getByTagNameInDocument`,
 * `getByDocumentId`, `getByAttributes`, and the value of a `readVersioned`) appended to `log` as `<tagName>#<id>`: what a bench reads to count the records one fetch
 * read more than once. Every other member is the store's own.
 */
export function recordingStore(params: { store: Store; log: ReadLog }): Store {
	const { store, log } = params
	return new Proxy(store, {
		get: function memberOfStore(target, property) {
			return recordedMember({ target, property, log })
		},
	})
}

/** The store's member `property`, bound to it; a recorded read logs the records it answers. */
function recordedMember(params: { target: Store; property: PropertyKey; log: ReadLog }): unknown {
	const { target, property, log } = params
	const member: unknown = Reflect.get(target, property, target)
	if (typeof member !== 'function') return member
	const bound = member.bind(target) as (...args: unknown[]) => unknown
	if (!RECORDED_STORE_READS.has(property)) return bound
	return async function recordedRead(...args: unknown[]): Promise<unknown> {
		const answer = await bound(...args)
		logAnswer({
			log,
			answer: property === 'readVersioned' ? (answer as { value: unknown }).value : answer,
		})
		return answer
	}
}

/** Append the (tag, id) of each record of a read's answer (one record, or a list with gaps). */
// dialecte-allow argument-mutation: the log is the recorder's output, appended to as the reads happen
function logAnswer(params: { log: ReadLog; answer: unknown }): void {
	const { log, answer } = params
	const records = (Array.isArray(answer) ? answer : [answer]) as (
		| { tagName: string; id: string }
		| undefined
	)[]
	for (const record of records) {
		if (record) log.keys.push(`${record.tagName}#${record.id}`)
	}
}
