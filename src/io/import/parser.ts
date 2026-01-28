import { isSaxQualifiedTag } from './guards'
import { registerPendingChildrenRelationship } from './relationships'

import * as sax from 'sax'

import { assert, DEV_ID } from '@/helpers'

import type { ParserInstance, ParserState } from './types'
import type {
	Namespace,
	AnyDialecteConfig,
	AnyRawRecord,
	AnyQualifiedAttribute,
	AnyAttribute,
	AnyRelationship,
} from '@/types'

//====== PUBLIC FUNCTIONS ======//

/**
 * Sets up the SAX parser for XML parsing.
 * @param namespaces Namespace configuration from dialecte
 * @param useCustomRecordsIds Whether to use custom record IDs from the XML attributes
 * @returns SAX parser instance
 */
export function setSaxParser(params: {
	dialecteConfig: AnyDialecteConfig
	useCustomRecordsIds: boolean
}): ParserInstance {
	const { dialecteConfig, useCustomRecordsIds } = params

	const initialState: ParserState = {
		defaultNamespace: null,
		stack: [],
		recordsBatch: [],
	}

	let updatedState = initialState

	const parser = sax.parser(
		true, // strict mode
		{
			lowercase: false, // Preserve case
			trim: true, // Trim text nodes
			normalize: true, // Normalize whitespace
			position: false, // Don't track position (performance boost)
			xmlns: true, // Enable namespace handling
		},
	)

	parser.onopentag = (node: sax.QualifiedTag) =>
		(updatedState = handleOpenTag({
			node,
			state: updatedState,
			dialecteConfig,
			useCustomRecordsIds,
		}))

	parser.ontext = (text: string) => (updatedState = handleText({ text, state: updatedState }))

	parser.onclosetag = () =>
		({ updatedState } = handleCloseTag({
			state: updatedState,
		}))

	parser.onerror = handleError

	function drainBatch() {
		const snapshot = updatedState.recordsBatch
		updatedState.recordsBatch = []
		return snapshot
	}

	function getSize() {
		return updatedState.recordsBatch.length
	}

	return {
		parser,
		drainBatch,
		getSize,
	}
}

//====== PARSER EVENT HANDLERS ======//

/**
 * Handles the opening tag event.
 * @param node sax element
 * @param state Current tracker state
 * @param namespaces Namespace configuration from dialecte
 * @returns Updated tracker state
 */
function handleOpenTag(params: {
	node: sax.QualifiedTag
	state: ParserState
	dialecteConfig: AnyDialecteConfig
	useCustomRecordsIds: boolean
}) {
	const { node, state, dialecteConfig, useCustomRecordsIds } = params
	const updatedState = { ...state }

	const tagName = getElementLocalName(node)

	if (!updatedState.defaultNamespace)
		updatedState.defaultNamespace = getDefaultNamespace({
			element: node,
			defaultNamespace: dialecteConfig.namespaces.default,
			rootElementName: dialecteConfig.rootElementName,
		})

	const namespace = getElementNamespace(node, updatedState.defaultNamespace)

	const id = getElementId({ attributes: node.attributes, useCustomRecordsIds })
	const filteredAttributes = getFilteredAttributes({
		attributes: node.attributes,
		useCustomRecordsIds,
	})

	const attributes = getElementAttributes(filteredAttributes)
	const parent = getParent(state.stack)

	const record: AnyRawRecord = {
		id,
		tagName,
		namespace,
		attributes,
		value: '',
		parent,
		children: [],
	}

	updatedState.stack.push(record)

	return updatedState
}

/**
 * Handles the text event.
 * @param text Text content of the current element
 * @param state Current state
 * @returns Updated state
 *
 */
function handleText(params: { text: string; state: ParserState }): ParserState {
	const { text, state } = params

	if (!text) return state
	if (state.stack.length > 0) state.stack[state.stack.length - 1].value += text

	return state
}

/**
 * Handles the closing tag event.
 * @param tagName Name of the closing tag
 * @param state Current state
 * @param databaseInstance Dexie database instance
 * @param options Parser options
 * @returns Updated state
 */
function handleCloseTag(params: { state: ParserState }): {
	updatedState: ParserState
} {
	const { state } = params

	const currentRecord = state.stack.at(-1)
	// removing the last record from the stack and current parent elements
	let updatedStack = state.stack.slice(0, -1)
	const updatedRecordsBatch = [...state.recordsBatch]

	if (currentRecord) {
		if (updatedStack.length) {
			// create children relationship if parent is still in the stack
			const parentIndex = updatedStack.length - 1

			updatedStack = updatedStack.map((item, currentIndex) =>
				currentIndex === parentIndex
					? {
							...item,
							children: [
								...item.children,
								{ id: currentRecord.id, tagName: currentRecord.tagName },
							],
						}
					: item,
			)
		} else if (currentRecord.parent) {
			registerPendingChildrenRelationship({
				parentId: currentRecord.parent.id,
				child: { id: currentRecord.id, tagName: currentRecord.tagName },
			})
		}

		updatedRecordsBatch.push(currentRecord)
	}

	return {
		updatedState: {
			defaultNamespace: state.defaultNamespace,
			stack: updatedStack,
			recordsBatch: updatedRecordsBatch,
		},
	}
}

/**
 * Handles SAX parser errors.
 * @param error SAX parser error
 * @returns Error object with a message
 */
function handleError(error: Error): Error {
	return new Error(`XML parsing error: ${error}`)
}

//====== HELPER FUNCTIONS ======//

function getElementLocalName(element: sax.QualifiedTag): string {
	return element.local
}

function getDefaultNamespace(params: {
	element: sax.QualifiedTag
	defaultNamespace: Namespace
	rootElementName: string
}): Namespace {
	const { element, defaultNamespace, rootElementName } = params
	assert(
		element.name === rootElementName,
		`Default namespace can only be set on ${rootElementName} element`,
	)

	if (element.attributes?.xmlns?.value)
		return {
			prefix: '',
			uri: element.attributes.xmlns.value,
		}

	return defaultNamespace
}

function getElementNamespace(
	element: sax.Tag | sax.QualifiedTag,
	defaultNamespace: Namespace,
): Namespace {
	if (isSaxQualifiedTag(element))
		return {
			prefix: element.prefix,
			uri: element.uri,
		}
	return defaultNamespace
}

function getElementAttributes(
	attributes: sax.QualifiedAttribute[],
): (AnyAttribute | AnyQualifiedAttribute)[] {
	// TODO: see https://github.com/SeptKit/set/issues/789
	// xmlns attributes NOT filtered here - some extensions may need them during import
	// Export filters them defensively to prevent issues with malformed data

	return attributes.map((attribute) => {
		const namespace =
			!!attribute.prefix && !!attribute.uri
				? {
						prefix: attribute.prefix,
						uri: attribute.uri,
					}
				: undefined

		// We always use the name value without prefix for storage
		const attributeName = namespace ? attribute.local : attribute.name

		return {
			name: attributeName,
			value: attribute.value,
			...(namespace && { namespace }),
		}
	})
}

function getParent(stack: AnyRawRecord[]): AnyRelationship | null {
	if (stack.length === 0) return null
	const lastParent = stack[stack.length - 1]
	return lastParent ? { id: lastParent.id, tagName: lastParent.tagName } : null
}

function getElementId(params: {
	attributes: Record<string, sax.QualifiedAttribute>
	useCustomRecordsIds: boolean
}): string {
	const { attributes, useCustomRecordsIds } = params
	const testIdAttribute = attributes[DEV_ID]

	if (useCustomRecordsIds && testIdAttribute && testIdAttribute.value) return testIdAttribute.value
	return crypto.randomUUID()
}

function getFilteredAttributes(params: {
	attributes: Record<string, sax.QualifiedAttribute>
	useCustomRecordsIds: boolean
}): sax.QualifiedAttribute[] {
	const { attributes, useCustomRecordsIds } = params

	if (useCustomRecordsIds) return Object.values(attributes).filter((attr) => attr.name !== DEV_ID)
	return Object.values(attributes)
}
