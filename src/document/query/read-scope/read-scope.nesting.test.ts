import { inMemoryTestStore, openScopedProject, versionedStore } from './read-scope.fixtures'

import { afterEach, describe, expect, it } from 'vitest'

import { XMLNS_DEFAULT_NAMESPACE, XMLNS_DEV_NAMESPACE } from '@/test'

import type { VersionedReadLog } from './read-scope.fixtures'

const ns = `${XMLNS_DEFAULT_NAMESPACE} ${XMLNS_DEV_NAMESPACE}`
const XML = /* xml */ `<Root ${ns}><A aA="one"/><A aA="two"/></Root>`

// Nested calls (an extension verb calling core methods and other extension verbs) share the scope of the call
// that opened it; unrelated calls never share one, and a scope ends with its call.
describe('read scope, nested calls', () => {
	const projects: Array<{ destroy: () => Promise<void> }> = []
	afterEach(async () => {
		await Promise.all(projects.map((project) => project.destroy()))
		projects.length = 0
	})

	async function open() {
		const log: VersionedReadLog = []
		const store = versionedStore({ store: inMemoryTestStore({ name: crypto.randomUUID() }), log })
		const opened = await openScopedProject({ store, log, sourceXml: XML })
		projects.push(opened.project)
		return { ...opened, log }
	}

	it('an extension verb calling another extension verb → one scope for both', async () => {
		const { document, first, log } = await open()

		await document.query.probe.readThroughNested(first)

		expect(log).toEqual([{ member: 'get', first: first.id }])
	})

	it('an extension verb calling core methods → one scope for all of them', async () => {
		const { document, first, log } = await open()

		const [value, record] = await document.query.probe.readWithCoreMethods(first)

		expect({ value, id: (record as { id: string } | undefined)?.id, reads: log }).toEqual({
			value: 'one',
			id: first.id,
			reads: [{ member: 'get', first: first.id }],
		})
	})

	it('the untyped namespace inside a call → the call’s scope', async () => {
		const { document, first, log } = await open()

		await document.query.probe.readViaAny(first)

		expect(log).toEqual([{ member: 'get', first: first.id }])
	})

	it('two concurrent calls on one Query → two scopes, nothing shared', async () => {
		const { document, first, log } = await open()
		const query = document.query

		await Promise.all([query.probe.readTwice(first), query.probe.readTwice(first)])

		expect(log).toEqual([
			{ member: 'get', first: first.id },
			{ member: 'get', first: first.id },
		])
	})

	it('a scoped query kept after its call → each later verb opens a fresh scope', async () => {
		const { document, first, log } = await open()
		const kept = document.query.probe.keepQuery()

		await kept.getRecord(first)
		await kept.getRecord(first)

		expect(log).toEqual([
			{ member: 'get', first: first.id },
			{ member: 'get', first: first.id },
		])
	})
})
