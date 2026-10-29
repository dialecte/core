import { outcomeOf, watchedClient } from './engine-client.fixtures'

import { afterEach, describe, expect, it } from 'vitest'

// A page's lifecycle: a frozen tab's document resumed, an event only a page dispatches.

/** What a case leaves: its clients closed, its fake engines' ports closed. */
const cleanups: (() => void)[] = []

afterEach(() => {
	for (const cleanup of cleanups.splice(0).reverse()) cleanup()
})

describe('a client watching its engine, on a page', () => {
	it('the document resumed (a frozen tab coming back) while a call waits → the silence counts from the resume', async () => {
		const { client } = watchedClient({ cleanups })
		const calling = outcomeOf(client.api.getDocuments())
		await new Promise((resolve) => setTimeout(resolve, 250))
		document.dispatchEvent(new Event('resume'))
		const early = await Promise.race([
			calling,
			new Promise((resolve) => setTimeout(() => resolve('waiting'), 200)),
		])
		expect(early).toBe('waiting')
		const outcome = await calling
		expect(outcome).toEqual({ key: 'STORE_ENGINE_LOST', meta: { reason: 'no-heartbeat' } })
	})
})
