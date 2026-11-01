import { Project } from './project'

import { afterEach, describe, expect, it } from 'vitest'

import { TEST_DIALECTE_CONFIG } from '@/test'
import { resolveTestStorage } from '@/test/test-storage'

import type { AnyDialecteConfig } from '@/types'

const CONFIG = TEST_DIALECTE_CONFIG as unknown as AnyDialecteConfig

function projectName(): string {
	return `blob-test-${crypto.randomUUID()}`
}

function openProject(name: string) {
	return new Project({ configs: { default: CONFIG }, storage: resolveTestStorage({}) }).open(name)
}

describe('Project - blobs', () => {
	const cleanups: Array<() => Promise<void>> = []

	afterEach(async () => {
		for (const fn of cleanups) await fn()
		cleanups.length = 0
	})

	it('addBlob stores file metadata + binary, returns id', async () => {
		const project = await openProject(projectName())
		cleanups.push(() => project.destroy())

		const documentId = await project.initEmptyDocument()
		const file = new File(['payload'], 'doc.pdf', { type: 'application/pdf' })

		const blobId = await project.addBlob(documentId, file)

		const result = await project.getBlob(blobId)
		expect(result?.entry.name).toBe('doc.pdf')
		expect(result?.entry.mimeType).toBe('application/pdf')
		expect(result?.entry.size).toBe(file.size)
		expect(result?.entry.documentId).toBe(documentId)
		expect(result?.entry.attachedTo).toEqual([])
		const payload = await result?.data.text()
		expect(payload).toBe('payload')
	})

	it('addBlob accepts initial attachments', async () => {
		const project = await openProject(projectName())
		cleanups.push(() => project.destroy())

		const documentId = await project.initEmptyDocument()
		const file = new File(['x'], 'a.txt')

		const blobId = await project.addBlob(documentId, file, [
			{ documentId, recordRef: 'r1', attribute: 'ref' },
		])

		const result = await project.getBlobsByRecord(documentId, 'r1')
		expect(result.map((blob) => blob.id)).toEqual([blobId])
	})

	it('attachBlob/detachBlob update references', async () => {
		const project = await openProject(projectName())
		cleanups.push(() => project.destroy())

		const documentId = await project.initEmptyDocument()
		const blobId = await project.addBlob(documentId, new File(['x'], 'a.txt'))

		await project.attachBlob(blobId, { documentId, recordRef: 'r1' })
		const attachedBlobs = await project.getBlobsByDocument(documentId)
		expect(attachedBlobs.map((blob) => blob.id)).toEqual([blobId])

		await project.detachBlob(blobId, { documentId, recordRef: 'r1' })
		const blobsAfterDetach = await project.getBlobsByDocument(documentId)
		expect(blobsAfterDetach).toEqual([])
		const standaloneBlobs = await project.getStandaloneBlobs()
		expect(standaloneBlobs.map((blob) => blob.id)).toEqual([blobId])
	})

	it('removeBlob hard-deletes regardless of attachments', async () => {
		const project = await openProject(projectName())
		cleanups.push(() => project.destroy())

		const documentId = await project.initEmptyDocument()
		const blobId = await project.addBlob(documentId, new File(['x'], 'a.txt'), [
			{ documentId, recordRef: 'r1' },
		])

		await project.removeBlob(blobId)
		const removedBlob = await project.getBlob(blobId)
		expect(removedBlob).toBeUndefined()
	})

	it('removeDocument cascades to owned blobs', async () => {
		const project = await openProject(projectName())
		cleanups.push(() => project.destroy())

		const documentId = await project.initEmptyDocument()
		const blobId = await project.addBlob(documentId, new File(['x'], 'a.txt'))

		await project.removeDocument(documentId)
		const removedBlob = await project.getBlob(blobId)
		expect(removedBlob).toBeUndefined()
	})

	it('broadcasts blob-added / blob-attached / blob-detached / blob-removed', async () => {
		const name = projectName()
		const project = await openProject(name)
		cleanups.push(() => project.destroy())

		const documentId = await project.initEmptyDocument()

		const messages: unknown[] = []
		const listener = project.createChannel()
		listener.onmessage = (event) => messages.push(event.data)
		cleanups.push(async () => listener.close())

		const blobId = await project.addBlob(documentId, new File(['x'], 'a.txt'))
		await project.attachBlob(blobId, { documentId, recordRef: 'r1' })
		await project.detachBlob(blobId, { documentId, recordRef: 'r1' })
		await project.removeBlob(blobId)

		await new Promise((resolve) => setTimeout(resolve, 10))

		expect(messages).toContainEqual(
			expect.objectContaining({ type: 'blob-added', blobId, documentId }),
		)
		expect(messages).toContainEqual(expect.objectContaining({ type: 'blob-attached', blobId }))
		expect(messages).toContainEqual(expect.objectContaining({ type: 'blob-detached', blobId }))
		expect(messages).toContainEqual(expect.objectContaining({ type: 'blob-removed', blobId }))
	})
})
