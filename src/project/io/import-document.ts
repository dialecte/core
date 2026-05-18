import { buildDocumentState } from '../state/document-state'

import { invariant } from '@/utils'
import { parseXmlFile } from '@/xml'

import type { ImportDocumentParams, ImportDocumentResult } from '../types'
import type { DocumentRecord } from '@/project'

/**
 * Import a File into the project: register document, parse XML, persist records, resolve root.
 * Pure orchestration - no class state mutation.
 */
export async function importDocument(params: ImportDocumentParams): Promise<ImportDocumentResult> {
	const { file, store, configs, defaultConfigKey, options } = params

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

	const documentRecord: DocumentRecord = {
		id: documentId,
		name,
		extension,
		configKey,
		createdAt: Date.now(),
		metadata: options?.metadata,
	}

	await store.registerDocument(documentRecord)

	const { recordCount } = await parseXmlFile({
		file,
		documentId,
		store,
		config,
		useCustomRecordsIds: options?.useCustomRecordsIds,
		chunkOptions: options?.chunkOptions,
	})

	return {
		documentId,
		record: documentRecord,
		documentState: buildDocumentState(documentRecord),
		recordCount,
	}
}
