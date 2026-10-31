import { Project } from './project'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { InMemoryStore } from '@/store'
import { TEST_DIALECTE_CONFIG, XMLNS_DEFAULT_NAMESPACE } from '@/test'

import type { Store, StoreNotice } from '@/store'
import type { AnyDialecteConfig } from '@/types'

const CONFIG = TEST_DIALECTE_CONFIG as unknown as AnyDialecteConfig
const RUNTIME = { configs: { default: CONFIG }, defaultConfigKey: 'default' }

/** The stores a case made: destroyed after it. */
const made: Store[] = []

afterEach(async () => {
	for (const store of made.splice(0)) await store.destroy()
})

/**
 * An in-memory store whose notices the case sends itself (`tell`): what the store says of its changes is held back,
 * so the project learns only what the case tells it.
 */
function toldStore(params: { name: string }): {
	store: Store
	tell: (notice: StoreNotice) => void
} {
	const store = new InMemoryStore(params.name, { runtime: RUNTIME })
	let told: (notice: StoreNotice) => void = function nobody() {}
	store.subscribe = function captureListener(listener) {
		told = listener
		return function stopListening() {}
	}
	return {
		store,
		tell: function tellProject(notice) {
			told(notice)
		},
	}
}

describe('a project told by its store', () => {
	it('to read again (resync) → the documents written meanwhile in its state, each document’s view woken', async () => {
		const name = `notices-${crypto.randomUUID()}`
		const { store, tell } = toldStore({ name })
		const project = await new Project({
			configs: { default: CONFIG },
			storage: { type: 'custom', store },
		}).open(name)
		const { documentId: seen } = await project.importFile(
			new File([`<Root ${XMLNS_DEFAULT_NAMESPACE}/>`], 'seen.xml'),
		)
		let woken = 0
		project.openDocument(seen).subscribe(function wake() {
			woken += 1
		})
		// written by another store of the project, its change never told to this one
		const elsewhere = new InMemoryStore(name, { runtime: RUNTIME })
		made.push(elsewhere)
		await elsewhere.open()
		const { record } = await elsewhere.importFile({
			file: new File([`<Root ${XMLNS_DEFAULT_NAMESPACE}/>`], 'unseen.xml'),
		})
		await elsewhere.close()
		expect(project.state.documents.has(record.id)).toBe(false)

		tell({ type: 'resync' })

		await vi.waitFor(function readAgain() {
			expect(project.state.documents.has(record.id)).toBe(true)
			expect(woken).toBeGreaterThan(0)
		})
		await project.close()
	})

	/** An in-memory store counting the listeners subscribed to it and not let go; `refuseOpen` fails its open. */
	function countedStore(params: { name: string; refuseOpen?: boolean }): {
		store: Store
		listening: () => number
	} {
		const store = new InMemoryStore(params.name, { runtime: RUNTIME })
		const subscribe = store.subscribe.bind(store)
		let listening = 0
		store.subscribe = function countListener(listener) {
			listening += 1
			const stop = subscribe(listener)
			return function stopCounted() {
				listening -= 1
				stop()
			}
		}
		if (params.refuseOpen) {
			store.open = async function refuseOpen() {
				throw new Error('refused')
			}
		}
		return {
			store,
			listening: function count() {
				return listening
			},
		}
	}

	type ListenCase = {
		act: (params: { name: string }) => Promise<{ listening: () => number; expected: number }>
	}
	const listenCases: Record<string, ListenCase> = {
		'closed → its store no longer listened to': {
			act: async function closed({ name }) {
				const { store, listening } = countedStore({ name })
				made.push(store)
				const project = await new Project({
					configs: { default: CONFIG },
					storage: { type: 'custom', store },
				}).open(name)
				await project.close()
				return { listening, expected: 0 }
			},
		},
		'its open refused by its store → that store no longer listened to': {
			act: async function refused({ name }) {
				const { store, listening } = countedStore({ name, refuseOpen: true })
				const project = new Project({
					configs: { default: CONFIG },
					storage: { type: 'custom', store },
				})
				await expect(project.open(name)).rejects.toThrow('refused')
				return { listening, expected: 0 }
			},
		},
		'opened again under another name → one store listened to': {
			act: async function reopened({ name }) {
				const { store, listening } = countedStore({ name })
				made.push(store)
				const project = new Project({
					configs: { default: CONFIG },
					storage: { type: 'custom', store },
				})
				await project.open(name)
				await project.open(`${name}-again`)
				const count = listening()
				await project.close()
				return { listening: () => count, expected: 1 }
			},
		},
	}
	for (const [description, { act }] of Object.entries(listenCases)) {
		it(description, async () => {
			const { listening, expected } = await act({ name: `notices-${crypto.randomUUID()}` })
			expect(listening()).toBe(expected)
		})
	}
})
