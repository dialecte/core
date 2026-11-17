import { inMemoryTestStore, openScopedProject, versionedStore } from './read-scope.fixtures'

import { afterEach, describe, expect, it } from 'vitest'

import { XMLNS_DEFAULT_NAMESPACE, XMLNS_DEV_NAMESPACE } from '@/test'

import type { VersionedReadLog } from './read-scope.fixtures'

const ns = `${XMLNS_DEFAULT_NAMESPACE} ${XMLNS_DEV_NAMESPACE}`
const XML = /* xml */ `<Root ${ns}><A aA="one"/><A aA="two"/></Root>`

// A public verb call runs in one read scope: the records it read once are answered from it, as copies, until the
// call returns. Reads go through `readVersioned`, so the log holds the store reads the scope did not answer.
describe('read scope, one per call', () => {
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

	it('a record read twice inside one verb call → one store read', async () => {
		const { document, first, log } = await open()

		const [once, twice] = await document.query.probe.readTwice(first)

		expect({ once: once?.id, twice: twice?.id, reads: log }).toEqual({
			once: first.id,
			twice: first.id,
			reads: [{ member: 'get', first: first.id }],
		})
	})

	it('the same record read in two top-level calls → two store reads', async () => {
		const { document, first, log } = await open()

		await document.query.getRecord(first)
		await document.query.getRecord(first)

		expect(log).toEqual([
			{ member: 'get', first: first.id },
			{ member: 'get', first: first.id },
		])
	})

	it('a record of a tag read earlier in the call → answered from the scope', async () => {
		const { document, first, log } = await open()

		const record = await document.query.probe.readTagThenRecord(first)

		expect({ id: record?.id, reads: log }).toEqual({
			id: first.id,
			reads: [{ member: 'getByTagNameInDocument', first: 'A' }],
		})
	})

	it('several records, one of them read earlier in the call → the store reads only the others', async () => {
		const { document, first, second, log } = await open()

		const records = await document.query.probe.readOneThenBoth([first, second])

		expect({ ids: records.map((record) => record?.id), reads: log }).toEqual({
			ids: [first.id, second.id],
			reads: [
				{ member: 'get', first: first.id },
				{ member: 'getMany', first: [second.id] },
			],
		})
	})

	it('a record answered from the scope and mutated by its caller → the scope and other callers unchanged', async () => {
		const { document, first, log } = await open()

		const again = await document.query.probe.mutateThenRead(first)

		expect({ value: again?.attributes[0].value, reads: log.length }).toEqual({
			value: 'one',
			reads: 1,
		})
	})
})
