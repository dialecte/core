import { Project } from './project'

import { afterEach, describe, expect, it } from 'vitest'

import { TEST_DIALECTE_CONFIG } from '@/test'

import type { AnyDialecteConfig } from '@/types'

// ── Helpers ──────────────────────────────────────────────────────────────────

const CONFIG = TEST_DIALECTE_CONFIG as unknown as AnyDialecteConfig

function projectName(): string {
	return `broadcast-test-${crypto.randomUUID()}`
}

function openProject(name: string) {
	return new Project({ configs: { default: CONFIG }, storage: { type: 'local' } }).open(name)
}

function minimalXml(): string {
	return `<Root xmlns="${CONFIG.namespaces.default.uri}"><A/></Root>`
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('Project BroadcastChannel', () => {
	const cleanups: Array<() => Promise<void>> = []

	afterEach(async () => {
		for (const fn of cleanups) await fn()
		cleanups.length = 0
	})

	it('posts init-empty-document message on initEmptyDocument', async () => {
		const name = projectName()
		const project = await openProject(name)
		cleanups.push(() => project.destroy())

		const messages: unknown[] = []
		const listener = new BroadcastChannel(`dialecte::project::${name}`)
		listener.onmessage = (e) => messages.push(e.data)
		cleanups.push(async () => listener.close())

		await project.initEmptyDocument()

		// BroadcastChannel delivers asynchronously - wait one microtask tick
		await new Promise((r) => setTimeout(r, 10))

		expect(messages).toContainEqual(expect.objectContaining({ type: 'init-empty-document' }))
	})

	it('posts document-removed message on removeDocument', async () => {
		const name = projectName()
		const project = await openProject(name)
		cleanups.push(() => project.destroy())

		const documentId = await project.initEmptyDocument()

		const messages: unknown[] = []
		const listener = new BroadcastChannel(`dialecte::project::${name}`)
		listener.onmessage = (e) => messages.push(e.data)
		cleanups.push(async () => listener.close())

		await project.removeDocument(documentId)
		await new Promise((r) => setTimeout(r, 10))

		expect(messages).toContainEqual(
			expect.objectContaining({ type: 'document-removed', documentId }),
		)
	})

	it('posts document-imported message on import', async () => {
		const name = projectName()
		const project = await openProject(name)
		cleanups.push(() => project.destroy())

		const messages: unknown[] = []
		const listener = new BroadcastChannel(`dialecte::project::${name}`)
		listener.onmessage = (e) => messages.push(e.data)
		cleanups.push(async () => listener.close())

		const file = new File([minimalXml()], 'test.xml', { type: 'application/xml' })
		await project.import(file)
		await new Promise((r) => setTimeout(r, 10))

		expect(messages).toContainEqual(expect.objectContaining({ type: 'document-imported' }))
	})

	it('Document commit posts commit message with documentId', async () => {
		const name = projectName()
		const project = await openProject(name)
		cleanups.push(() => project.destroy())

		const file = new File([minimalXml()], 'test.xml', { type: 'application/xml' })
		const { documentId } = await project.import(file)
		const doc = project.openDocument(documentId)

		const messages: unknown[] = []
		const listener = new BroadcastChannel(`dialecte::project::${name}`)
		listener.onmessage = (e) => messages.push(e.data)
		cleanups.push(async () => listener.close())

		await doc.transaction(async (tx) => {
			const root = await tx.getRoot()
			tx.addChild(root, { tagName: 'A', attributes: [] })
		})

		await new Promise((r) => setTimeout(r, 10))

		expect(messages).toContainEqual(expect.objectContaining({ type: 'commit', documentId }))
	})

	it('Document receives commit from another Document on same channel', async () => {
		const name = projectName()
		const project = await openProject(name)
		cleanups.push(() => project.destroy())

		const file = new File([minimalXml()], 'test.xml', { type: 'application/xml' })
		const { documentId } = await project.import(file)

		// Simulate another tab's document by creating a second BroadcastChannel
		const otherTabChannel = new BroadcastChannel(`dialecte::project::${name}`)
		cleanups.push(async () => otherTabChannel.close())

		const doc = project.openDocument(documentId)

		expect(doc.state.lastUpdate).toBeNull()

		// Simulate a commit from another tab
		otherTabChannel.postMessage({ type: 'commit', documentId, timestamp: 12345 })
		await new Promise((r) => setTimeout(r, 10))

		expect(doc.state.lastUpdate).toBe(12345)
	})

	it('Document ignores commit messages for other files', async () => {
		const name = projectName()
		const project = await openProject(name)
		cleanups.push(() => project.destroy())

		const file = new File([minimalXml()], 'test.xml', { type: 'application/xml' })
		const { documentId } = await project.import(file)

		const otherTabChannel = new BroadcastChannel(`dialecte::project::${name}`)
		cleanups.push(async () => otherTabChannel.close())

		const doc = project.openDocument(documentId)

		// Send commit for a different file
		otherTabChannel.postMessage({ type: 'commit', documentId: 'other-file', timestamp: 99999 })
		await new Promise((r) => setTimeout(r, 10))

		expect(doc.state.lastUpdate).toBeNull()
	})
})
