import type { Store } from './store.types'
import type { DocumentRecord } from '@/project/types'

/**
 * Remove every document an import left `importing`: an import never outlives the store that ran
 * it, so what a store finds `importing` when it opens is a leftover - a closed tab, a crash. A store
 * shared by several connections names the imports still running (`isRunning`): they are kept. A row
 * is read again before it goes, so an import that ended since the registry was listed stays.
 */
export async function removeUnfinishedImports(params: {
	store: Pick<Store, 'getDocuments' | 'getDocument' | 'removeDocument'>
	isRunning?: (document: DocumentRecord) => boolean | Promise<boolean>
}): Promise<void> {
	const { store, isRunning } = params
	const documents = await store.getDocuments()
	for (const document of documents) {
		if (document.status !== 'importing') continue
		if (await isRunning?.(document)) continue
		const current = await store.getDocument(document.id)
		if (current?.status === 'importing') await store.removeDocument(document.id)
	}
}
