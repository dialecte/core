import { Project } from './project'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { TEST_DIALECTE_CONFIG } from '@/test'
import { resolveTestStorage } from '@/test/test-storage'
import { SILENCE_WAIT_MS } from '@/test/test-timing.constants'

import type { AnyDialecteConfig } from '@/types'

// ── Helpers ──────────────────────────────────────────────────────────────────

const CONFIG = TEST_DIALECTE_CONFIG as unknown as AnyDialecteConfig

function projectName(): string {
	return `broadcast-test-${crypto.randomUUID()}`
}

function openProject(name: string) {
	return new Project({ configs: { default: CONFIG }, storage: resolveTestStorage({}) }).open(name)
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
		const listener = project.createChannel()
		listener.onmessage = (event) => messages.push(event.data)
		cleanups.push(async () => listener.close())

		await project.initEmptyDocument()

		// BroadcastChannel delivers asynchronously: wait for the message
		await vi.waitFor(function messageHeard() {
			expect(messages).toContainEqual(expect.objectContaining({ type: 'init-empty-document' }))
		})
	})

	it('posts document-removed message on removeDocument', async () => {
		const name = projectName()
		const project = await openProject(name)
		cleanups.push(() => project.destroy())

		const documentId = await project.initEmptyDocument()

		const messages: unknown[] = []
		const listener = project.createChannel()
		listener.onmessage = (event) => messages.push(event.data)
		cleanups.push(async () => listener.close())

		await project.removeDocument(documentId)

		await vi.waitFor(function messageHeard() {
			expect(messages).toContainEqual(
				expect.objectContaining({ type: 'document-removed', documentId }),
			)
		})
	})

	it('posts document-imported message on import', async () => {
		const name = projectName()
		const project = await openProject(name)
		cleanups.push(() => project.destroy())

		const messages: unknown[] = []
		const listener = project.createChannel()
		listener.onmessage = (event) => messages.push(event.data)
		cleanups.push(async () => listener.close())

		const file = new File([minimalXml()], 'test.xml', { type: 'application/xml' })
		await project.importFile(file)

		await vi.waitFor(function messageHeard() {
			expect(messages).toContainEqual(expect.objectContaining({ type: 'document-imported' }))
		})
	})

	it('Document commit posts commit message with documentId', async () => {
		const name = projectName()
		const project = await openProject(name)
		cleanups.push(() => project.destroy())

		const file = new File([minimalXml()], 'test.xml', { type: 'application/xml' })
		const { documentId } = await project.importFile(file)
		const doc = project.openDocument(documentId)

		const messages: unknown[] = []
		const listener = project.createChannel()
		listener.onmessage = (event) => messages.push(event.data)
		cleanups.push(async () => listener.close())

		await doc.transaction(async (tx) => {
			const root = await tx.getRoot()
			tx.addChild(root, { tagName: 'A', attributes: [] })
		})

		await vi.waitFor(function messageHeard() {
			expect(messages).toContainEqual(expect.objectContaining({ type: 'commit', documentId }))
		})
	})

	it('a commit by another project of the name → this Document’s state takes its time, its view woken', async () => {
		const name = projectName()
		const project = await openProject(name)
		const other = await openProject(name)
		cleanups.push(async () => other.close())
		cleanups.push(() => project.destroy())

		const file = new File([minimalXml()], 'test.xml', { type: 'application/xml' })
		const { documentId } = await project.importFile(file)
		const doc = project.openDocument(documentId)
		expect(doc.state.lastUpdate).toBeNull()
		const heard: { type: string; documentId?: string; timestamp: number }[] = []
		const listener = project.createChannel()
		listener.onmessage = (event) => heard.push(event.data)
		cleanups.push(async () => listener.close())

		await other.getDocumentStatus(documentId)
		await other.openDocument(documentId).transaction(async (tx) => {
			const root = await tx.getRoot()
			tx.addChild(root, { tagName: 'A', attributes: [] })
		})

		await vi.waitFor(function commitHeard() {
			const commit = heard.find((message) => message.type === 'commit')
			expect(commit?.documentId).toBe(documentId)
			expect(doc.state.lastUpdate).toBe(commit?.timestamp)
		})
	})

	it('a commit by another project of the name on another document → this Document’s state unchanged', async () => {
		const name = projectName()
		const project = await openProject(name)
		const other = await openProject(name)
		cleanups.push(async () => other.close())
		cleanups.push(() => project.destroy())

		const file = new File([minimalXml()], 'test.xml', { type: 'application/xml' })
		const { documentId } = await project.importFile(file)
		const doc = project.openDocument(documentId)
		const { documentId: otherDocumentId } = await other.importFile(file)
		await other.openDocument(otherDocumentId).transaction(async (tx) => {
			const root = await tx.getRoot()
			tx.addChild(root, { tagName: 'A', attributes: [] })
		})
		// nothing to wait for: a bounded wait, longer than a message takes on a loaded machine
		await new Promise((resolve) => setTimeout(resolve, SILENCE_WAIT_MS))

		expect(doc.state.lastUpdate).toBeNull()
	})

	it('getDocumentStatus reports live+ready for a document imported by another realm', async () => {
		const name = projectName()
		const shell = await openProject(name)
		const iframe = await openProject(name)
		cleanups.push(async () => iframe.close())
		cleanups.push(() => shell.destroy())

		const file = new File([minimalXml()], 'test.xml', { type: 'application/xml' })
		const { documentId } = await shell.importFile(file)

		const status = await iframe.getDocumentStatus(documentId)
		expect(status).toEqual({ live: true, ready: true })

		// The other realm can now open + export the document without throwing
		// (export reads the document's records table).
		iframe.openDocument(documentId)
		const exported = await iframe.export({ documentId, indent: false })
		const xml = await exported.file.text()
		expect(xml).toContain('<Root')
	})

	it('getDocumentStatus returns not-live for an unknown document without throwing', async () => {
		const name = projectName()
		const project = await openProject(name)
		cleanups.push(() => project.destroy())

		const status = await project.getDocumentStatus(crypto.randomUUID())
		expect(status).toEqual({ live: false, ready: false })
	})

	it('exposes channelName and guards it behind open()', async () => {
		const unopened = new Project({ configs: { default: CONFIG }, storage: resolveTestStorage({}) })
		expect(() => unopened.channelName).toThrow()

		const name = projectName()
		const project = await openProject(name)
		cleanups.push(() => project.destroy())

		// the name's channel, or one of this Project's own where its store announces its changes itself
		expect(project.channelName.startsWith(`dialecte::project::${name}`)).toBe(true)

		const documentId = await project.initEmptyDocument()
		const doc = project.openDocument(documentId)
		expect(doc.channelName).toBe(project.channelName)
	})

	it('project.createChannel() receives same-tab commit posts (public contract)', async () => {
		const name = projectName()
		const project = await openProject(name)
		cleanups.push(() => project.destroy())

		const file = new File([minimalXml()], 'test.xml', { type: 'application/xml' })
		const { documentId } = await project.importFile(file)
		const doc = project.openDocument(documentId)

		const listener = project.createChannel()
		const messages: unknown[] = []
		listener.addEventListener('message', (event) => messages.push(event.data))
		cleanups.push(async () => listener.close())

		await doc.transaction(async (tx) => {
			const root = await tx.getRoot()
			tx.addChild(root, { tagName: 'A', attributes: [] })
		})

		await vi.waitFor(function commitHeard() {
			expect(messages).toContainEqual(
				expect.objectContaining({ type: 'commit', documentId, timestamp: doc.state.lastUpdate }),
			)
		})
	})

	it('commit updates the shared project entry synchronously', async () => {
		const name = projectName()
		const project = await openProject(name)
		cleanups.push(() => project.destroy())

		const file = new File([minimalXml()], 'test.xml', { type: 'application/xml' })
		const { documentId } = await project.importFile(file)
		const doc = project.openDocument(documentId)

		// Document state IS the project entry
		expect(doc.state).toBe(project.state.documents.get(documentId))

		await doc.transaction(async (tx) => {
			const root = await tx.getRoot()
			tx.addChild(root, { tagName: 'A', attributes: [] })
		})

		// No channel round-trip needed: visible the moment the transaction resolves
		expect(project.state.documents.get(documentId)?.lastUpdate).not.toBeNull()
		expect(project.state.documents.get(documentId)?.lastUpdate).toBe(doc.state.lastUpdate)
	})

	it('two Documents for the same file share state', async () => {
		const name = projectName()
		const project = await openProject(name)
		cleanups.push(() => project.destroy())

		const file = new File([minimalXml()], 'test.xml', { type: 'application/xml' })
		const { documentId } = await project.importFile(file)
		const docA = project.openDocument(documentId)
		const docB = project.openDocument(documentId)

		await docA.transaction(async (tx) => {
			const root = await tx.getRoot()
			tx.addChild(root, { tagName: 'A', attributes: [] })
		})

		expect(docB.state.lastUpdate).toBe(docA.state.lastUpdate)
		expect(docB.state.lastUpdate).not.toBeNull()
	})

	it('keeps folding cross-tab messages after many openDocument calls (clobbering regression)', async () => {
		const name = projectName()
		const project = await openProject(name)
		cleanups.push(() => project.destroy())

		const { documentId: firstId } = await project.importFile(
			new File([minimalXml()], 'one.xml', { type: 'application/xml' }),
		)
		const { documentId: secondId } = await project.importFile(
			new File([minimalXml()], 'two.xml', { type: 'application/xml' }),
		)

		// Historically, each openDocument() overwrote the single shared
		// channel's onmessage handler — opening more documents killed
		// delivery to the earlier ones and to the Project itself.
		const firstDoc = project.openDocument(firstId)
		project.openDocument(secondId)
		project.openDocument(firstId)
		project.openDocument(secondId)

		// another tab: a project of the name of its own, committing on the first document
		const other = await openProject(name)
		await other.getDocumentStatus(firstId)
		await other.openDocument(firstId).transaction(async (tx) => {
			const root = await tx.getRoot()
			tx.addChild(root, { tagName: 'A', attributes: [] })
		})
		await other.close()

		await vi.waitFor(function commitHeard() {
			expect(firstDoc.state.lastUpdate).not.toBeNull()
			expect(project.state.documents.get(firstId)?.lastUpdate).toBe(firstDoc.state.lastUpdate)
		})
	})

	it('destroy() immediately after a commit does not throw (teardown race regression)', async () => {
		const name = projectName()
		const project = await openProject(name)

		const file = new File([minimalXml()], 'test.xml', { type: 'application/xml' })
		const { documentId } = await project.importFile(file)
		const doc = project.openDocument(documentId)

		await doc.transaction(async (tx) => {
			const root = await tx.getRoot()
			tx.addChild(root, { tagName: 'A', attributes: [] })
		})

		// A commit no longer schedules fire-and-forget store work via a self-echo,
		// so tearing down right after must not touch the store post-delete
		// (previously surfaced as DatabaseClosedError / ConstraintError).
		await expect(project.destroy()).resolves.toBeUndefined()
	})
})
