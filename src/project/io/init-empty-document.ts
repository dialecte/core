import { buildDocumentState } from '../state/document-state'

import { invariant } from '@/utils'

import type { InitEmptyDocumentParams, InitEmptyDocumentResult, DocumentRecord } from '../types'
import type { AnyAttribute, AnyRawRecord } from '@/types'

/**
 * Build a DocumentRecord, persist it, and create a root record in the store.
 * Pure orchestration - no class state mutation.
 */
export async function initEmptyDocument(
	params: InitEmptyDocumentParams,
): Promise<InitEmptyDocumentResult> {
	const { store, configs, defaultConfigKey, options } = params

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

	const rootDefinition = config.definition[config.rootElementName]

	const attributes: AnyAttribute[] = (rootDefinition?.attributes.sequence ?? [])
		.map((name) => ({ name, ...rootDefinition!.attributes.details[name] }))
		.filter((document) => document.required && (document.fixed ?? document.default) !== undefined)
		.map(({ name, fixed, default: def, namespace }) => {
			const attribute: AnyAttribute = { name, value: (fixed ?? def)! }
			if (namespace) attribute.namespace = namespace
			return attribute
		})

	const rootRecord: AnyRawRecord = {
		id: crypto.randomUUID(),
		tagName: config.rootElementName,
		namespace: config.namespaces.default,
		attributes,
		value: '',
		parent: null,
		children: [],
	}

	await store.bulkWrite(documentId, { creates: [rootRecord] })

	return { documentId, document: doc, documentState: buildDocumentState(doc) }
}
