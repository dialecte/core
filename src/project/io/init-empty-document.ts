import { buildDocumentState } from '../state/document-state'

import { standardizeRecord } from '@/helpers'
import { invariant } from '@/utils'

import type { InitEmptyDocumentParams, InitEmptyDocumentResult, DocumentRecord } from '../types'
import type { AnyRawRecord } from '@/types'

/**
 * Build a DocumentRecord, persist it, and create a root record in the store.
 * Pure orchestration - no class state mutation.
 */
export async function initEmptyDocument(
	params: InitEmptyDocumentParams,
): Promise<InitEmptyDocumentResult> {
	const { store, configs, defaultConfigKey, options, hooks } = params

	const configKey = options?.configKey ?? defaultConfigKey
	const config = configs[configKey]

	invariant(config, {
		key: 'UNKNOWN_CONFIG_KEY',
		detail: `Unknown configKey: "${configKey}". Available: ${Object.keys(configs).join(', ')}`,
	})

	const extension = options?.extension ?? config.io.supportedFileExtensions[0]
	const name = options?.name ?? 'untitled'
	const documentId = crypto.randomUUID()

	const doc: DocumentRecord = {
		id: documentId,
		name,
		extension,
		configKey,
		createdAt: Date.now(),
		metadata: options?.metadata,
	}

	await store.registerDocument(doc)

	// Build the root record through the same standardization as create/clone/import
	// so a freshly-created empty document shares one canonical form with every other
	// entry point. See [[standardizing]].
	const rootRecord: AnyRawRecord = standardizeRecord({
		dialecteConfig: config,
		hooks,
		record: {
			id: crypto.randomUUID(),
			tagName: config.rootElementName,
			namespace: config.namespaces.default,
			parent: null,
			children: [],
		},
	})

	await store.bulkWrite(documentId, { creates: [rootRecord] })

	return { documentId, record: doc, documentState: buildDocumentState(doc) }
}
