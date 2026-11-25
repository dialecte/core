import { buildDocumentState } from '../state/document-state'
import { resolveConfig } from './resolve-config'

import { standardizeRecord } from '@/helpers'
import { parseDocumentPath, readableExtensionsOf, splitFileName } from '@/store/document-path'
import { resolveDefinition } from '@/utils/resolve-definition'

import type {
	InitEmptyDocumentOptions,
	InitEmptyDocumentParams,
	InitEmptyDocumentResult,
	DocumentRecord,
} from '../types'
import type { AnyDialecteConfig, AnyRawRecord, AttributeInputOf } from '@/types'

/**
 * Build a DocumentRecord, persist it, and create a root record in the store: the root holds every attribute its
 * definition marks required and fixed, with that value. Pure orchestration - no class state mutation.
 *
 * @internal the store-level step behind `project.initEmptyDocument`; callers use the project
 */
export async function initEmptyDocument(
	params: InitEmptyDocumentParams,
): Promise<InitEmptyDocumentResult> {
	const { store, configs, defaultConfigKey, options, hooks } = params

	const { configKey, config } = resolveConfig({
		configs,
		defaultConfigKey,
		configKey: options?.configKey,
	})

	const documentId = crypto.randomUUID()
	const doc: DocumentRecord = {
		id: documentId,
		...emptyDocumentNameOf({ options, config }),
		configKey,
		createdAt: Date.now(),
		status: 'ready',
		metadata: options?.metadata,
		...(options?.path !== undefined && { path: options.path }),
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
			attributes: requiredFixedRootAttributesOf({ config }),
			parent: null,
			children: [],
		},
	})

	await store.bulkWrite(documentId, { creates: [rootRecord] })

	return { documentId, record: doc, documentState: buildDocumentState(doc) }
}

/**
 * The root's attributes its declared type marks required and fixed, each with its fixed value and its namespace:
 * what any document of the dialecte states on its root (a type the root names with xsi:type is not known yet). A required attribute with no fixed value has none to give; an optional one stays
 * absent, as in a file that leaves it out. Not the export's `required` view (`resolveSchemaAttributeValue`), which
 * also writes an empty required value and an optional fixed one into the file: a record stores only what the
 * schema leaves no choice about.
 */
function requiredFixedRootAttributesOf(params: {
	config: AnyDialecteConfig
}): AttributeInputOf<AnyDialecteConfig, string>[] {
	const { config } = params
	const definition = resolveDefinition({
		dialecteConfig: config,
		record: {
			tagName: config.rootElementName,
			parent: null,
			attributes: [],
			namespace: config.namespaces.default,
		},
	})
	const details = definition?.attributes.details ?? {}
	return Object.entries(details).flatMap(([name, attribute]) =>
		attribute.required && attribute.fixed !== undefined
			? [
					{
						name,
						value: attribute.fixed,
						...(attribute.namespace && { namespace: attribute.namespace }),
					},
				]
			: [],
	)
}

/**
 * The name and extension of a new document: the options', else its path's file name's (the extension one its config
 * reads, `.xml` always among them, unless the options give one), else 'untitled' and the first extension it reads.
 * Whether the path then names the document's file is the store's to check.
 */
function emptyDocumentNameOf(params: {
	options: InitEmptyDocumentOptions | undefined
	config: AnyDialecteConfig
}): Pick<DocumentRecord, 'name' | 'extension'> {
	const { options, config } = params
	const { path, name, extension } = options ?? {}
	const extensions = readableExtensionsOf({ extensions: config.io.supportedFileExtensions })
	if (path === undefined) {
		return { name: name ?? 'untitled', extension: extension ?? extensions[0] }
	}
	if (extension === undefined) {
		const split = splitFileName({ path, extensions })
		return { name: name ?? split.name, extension: split.extension }
	}
	const { fileName } = parseDocumentPath({ path })
	const named = fileName.endsWith(extension)
		? fileName.slice(0, fileName.length - extension.length)
		: fileName
	return { name: name ?? named, extension }
}
