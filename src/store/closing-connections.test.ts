import { createClosingConnections } from './closing-connections'

import { describe, expect, it } from 'vitest'

/** A promise settled when the case says, and whether something awaiting another one has settled yet. */
function deferred(): { promise: Promise<void>; resolve: () => void; reject: () => void } {
	let resolve: () => void = settleNothing
	let reject: () => void = settleNothing
	const promise = new Promise<void>(function keep(resolved, rejected) {
		resolve = resolved
		reject = rejected
	})
	return { promise, resolve, reject }
}

function settledYet(params: { promise: Promise<void> }): { settled: () => boolean } {
	let settled = false
	void params.promise.then(function markSettled() {
		settled = true
	})
	return {
		settled: function isSettled() {
			return settled
		},
	}
}

function nextTask(): Promise<void> {
	return new Promise(function waitATask(resolve) {
		setTimeout(resolve, 0)
	})
}

function settleNothing(): void {}

describe('createClosingConnections', () => {
	it('none closing → settled at once', async () => {
		const closing = createClosingConnections()
		await closing.settled({ name: 'a' })
	})

	it('one closing → settled once its operations have, even when they failed', async () => {
		const closing = createClosingConnections()
		const operations = deferred()
		closing.markClosing({ name: 'a', until: operations.promise })
		const waiting = settledYet({ promise: closing.settled({ name: 'a' }) })
		await nextTask()
		expect(waiting.settled()).toBe(false)
		operations.reject()
		await nextTask()
		expect(waiting.settled()).toBe(true)
	})

	it('another closing while the first settles → settled once both have', async () => {
		const closing = createClosingConnections()
		const first = deferred()
		const second = deferred()
		closing.markClosing({ name: 'a', until: first.promise })
		const waiting = settledYet({ promise: closing.settled({ name: 'a' }) })
		closing.markClosing({ name: 'a', until: second.promise })
		first.resolve()
		await nextTask()
		expect(waiting.settled()).toBe(false)
		second.resolve()
		await nextTask()
		expect(waiting.settled()).toBe(true)
	})

	it('one of another name closing → not waited for', async () => {
		const closing = createClosingConnections()
		closing.markClosing({ name: 'b', until: deferred().promise })
		await closing.settled({ name: 'a' })
	})
})
