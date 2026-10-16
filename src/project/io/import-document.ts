import { IMPORT_HEARTBEAT_MS } from '../state/document-lifecycle'
import { buildDocumentState } from '../state/document-state'

import { invariant } from '@/utils'
import { parseXmlFile } from '@/xml'

import type { ImportDocumentParams, ImportDocumentResult } from '../types'
import type { DocumentRecord } from '@/project'
import type { Store } from '@/store/store.types'

/**
 * Import a File into the project: register document, parse XML, persist records, resolve root.
 * Pure orchestration - no class state mutation.
 */
export async function importDocument(params: ImportDocumentParams): Promise<ImportDocumentResult> {
	const { file, store, configs, defaultConfigKey, options, hooks, perf } = params

	const configKey = options?.configKey ?? defaultConfigKey
	const config = configs[configKey]

	invariant(config, {
		key: 'UNKNOWN_CONFIG_KEY',
		detail: `Unknown configKey: "${configKey}". Available: ${Object.keys(configs).join(', ')}`,
	})

	const documentId = crypto.randomUUID()
	const extension = file.name.includes('.')
		? `.${file.name.split('.').pop()!}`
		: config.io.supportedFileExtensions[0]
	const name = file.name.replace(/\.[^.]+$/, '') || 'untitled'

	const registered: DocumentRecord = {
		id: documentId,
		name,
		extension,
		configKey,
		createdAt: Date.now(),
		metadata: options?.metadata,
		status: 'importing',
		importingAt: Date.now(),
	}

	await perfRegisterDocument(store, registered)

	// A document is whole or absent: whatever fails after registration - the parse, a hook, a store
	// write - removes it (best effort), and the failure is the caller's. While it runs, the heartbeat
	// tells another realm that opens the project the import is alive, not a leftover to sweep.
	const heartbeat = startImportHeartbeat(store, documentId)
	let parsed: Awaited<ReturnType<typeof parseXmlFile>>
	try {
		parsed = await parseXmlFile({
			file,
			documentId,
			configKey,
			store,
			config,
			useCustomRecordsIds: options?.useCustomRecordsIds,
			chunkOptions: options?.chunkOptions,
			hooks,
			perf,
		})
		clearInterval(heartbeat)
		await store.updateDocument(documentId, { status: 'ready' })
	} catch (failure) {
		clearInterval(heartbeat)
		try {
			await store.removeDocument(documentId)
		} catch {
			// the import failure is the one to report; a document whose row survived `importing`
			// is swept once its heartbeat is stale
		}
		throw failure
	}

	const documentRecord: DocumentRecord = { ...registered, status: 'ready' }

	return {
		documentId,
		record: documentRecord,
		documentState: buildDocumentState(documentRecord),
		recordCount: parsed.recordCount,
		diagnostics: parsed.diagnostics,
	}

	async function perfRegisterDocument(s: typeof store, r: DocumentRecord): Promise<void> {
		perf?.start('core::import::registerDocument')
		try {
			await s.registerDocument(r)
		} finally {
			perf?.stop('core::import::registerDocument')
		}
	}
}

/** Refresh `importingAt` every `IMPORT_HEARTBEAT_MS` until cleared; a heartbeat that fails is not an import failure. */
function startImportHeartbeat(store: Store, documentId: string): ReturnType<typeof setInterval> {
	return setInterval(async () => {
		try {
			await store.updateDocument(documentId, { importingAt: Date.now() })
		} catch {
			// a missed heartbeat is not an import failure; the next one may land
		}
	}, IMPORT_HEARTBEAT_MS)
}
