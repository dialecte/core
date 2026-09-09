import { isSaxQualifiedTag } from './guards'
import { ParseSession } from './parse-session'

import * as sax from 'sax'

import { CUSTOM_RECORD_ID_ATTRIBUTE, standardizeRecord } from '@/helpers'
import { NOOP_PERF } from '@/perf'
import { invariant } from '@/utils'

import type { ParserInstance, ParserState } from './types'
import type { Perf } from '@/perf'
import type {
	Namespace,
	AnyDialecteConfig,
	AnyRawRecord,
	AnyQualifiedAttribute,
	AnyAttribute,
	AnyRelationship,
	DialecteHooks,
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
	session: ParseSession
	hooks?: DialecteHooks<AnyDialecteConfig>
	perf?: Perf
}): ParserInstance {
	const { dialecteConfig, useCustomRecordsIds, session, hooks, perf = NOOP_PERF } = params

	// Single closure-private state, mutated in place per SAX event. The parser is
	// the sole sequential writer, so immutable rebuilds bought nothing and cost an
	// allocation (+ GC) per node — see handleOpenTag/handleCloseTag.
	const state: ParserState = {
		defaultNamespace: null,
		stack: [],
		recordsBatch: [],
	}

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

	// Self-time per handler (create-record / text / close+reconcile-children) via
	// the O(1) time accumulator, NOT per-call spans — millions of nodes would
	// otherwise flood the timeline. Surfaced as calls/totalMs/avgMs in report().
	parser.onopentag = (node: sax.QualifiedTag) => {
		perf.time('core::import::onOpenTag', () =>
			handleOpenTag({ node, state, dialecteConfig, useCustomRecordsIds }),
		)
	}

	parser.ontext = (text: string) => {
		perf.time('core::import::onText', () => handleText({ text, state }))
	}

	parser.oncdata = (cdata: string) => {
		perf.time('core::import::onText', () => handleText({ text: cdata, state }))
	}

	parser.onclosetag = () => {
		perf.time('core::import::onCloseTag', () =>
			handleCloseTag({ state, hooks, session, dialecteConfig, perf }),
		)
	}

	parser.onerror = handleError

	function drainBatch() {
		const snapshot = state.recordsBatch
		state.recordsBatch = []
		return snapshot
	}

	function getSize() {
		return state.recordsBatch.length
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
}): void {
	const { node, state, dialecteConfig, useCustomRecordsIds } = params

	const tagName = getElementLocalName(node)

	if (!state.defaultNamespace)
		state.defaultNamespace = getDefaultNamespace({
			element: node,
			defaultNamespace: dialecteConfig.namespaces.default,
			rootElementName: dialecteConfig.rootElementName,
		})

	const namespace = getElementNamespace(node, state.defaultNamespace)

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

	state.stack.push(record)
}

/**
 * Handles the text event.
 * @param text Text content of the current element
 * @param state Current state
 * @returns Updated state
 *
 */
function handleText(params: { text: string; state: ParserState }): void {
	const { text, state } = params

	if (!text) return
	if (state.stack.length > 0) state.stack[state.stack.length - 1].value += text
}

/**
 * Handles the closing tag event.
 * @param state Current state
 * @param session Parse session
 * @param hooks Dialecte hooks (io + record lifecycle), from the Project instance
 * @returns Updated state
 */
function handleCloseTag(params: {
	state: ParserState
	session: ParseSession
	hooks?: DialecteHooks<AnyDialecteConfig>
	dialecteConfig: AnyDialecteConfig
	perf?: Perf
}): void {
	const { state, hooks, session, dialecteConfig, perf = NOOP_PERF } = params

	// Pop the closing record in place; the stack now holds only its ancestors.
	const rawRecord = state.stack.pop()
	if (!rawRecord) return

	// Standardize the parsed record to the same canonical form produced by
	// create/clone (schema attribute order + defaults + namespace +
	// afterStandardizedRecord hook). Keeps the store's canonical form
	// consistent across entry points so record comparison (e.g. the merging
	// editor) doesn't flag standardization artifacts as changes. id/tagName/
	// parent/children are preserved, so parent→child references stay valid.
	//
	// Runs BEFORE beforeImportRecord so that hook receives the finalized record
	// (canonical attributes + any hook-enforced uuid already present), letting
	// it index / resolve references without re-implementing standardization.
	const currentRecord = perf.time('core::import::onCloseTag::standardize', () =>
		standardizeRecord({
			dialecteConfig,
			hooks,
			record: rawRecord,
		}),
	)

	if (hooks?.beforeImportRecord) {
		perf.time('core::import::onCloseTag::beforeHook', () =>
			hooks.beforeImportRecord!({
				record: currentRecord,
				ancestry: state.stack,
			}),
		)
	}

	perf.time('core::import::onCloseTag::reconcileChildren', () => {
		const parent = state.stack[state.stack.length - 1]
		if (parent) {
			// Mutate the still-open parent's children in place; it captures them when it
			// standardizes on its own close.
			parent.children.push({ id: currentRecord.id, tagName: currentRecord.tagName })
		} else if (currentRecord.parent) {
			// Parent already left the stack (drained in an earlier batch) → resolve later.
			session.registerPendingChild(currentRecord.parent.id, {
				id: currentRecord.id,
				tagName: currentRecord.tagName,
			})
		}
	})

	state.recordsBatch.push(currentRecord)
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
	invariant(element.name === rootElementName, {
		detail: `Expected root element <${rootElementName}>, got <${element.name}>`,
	})

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

		// xmlns="..." has prefix='xmlns' and local='': use 'xmlns' as key instead of ''
		const attributeName =
			attribute.prefix === 'xmlns' && attribute.local === ''
				? 'xmlns'
				: namespace
					? attribute.local
					: attribute.name

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
	const testIdAttribute = attributes[CUSTOM_RECORD_ID_ATTRIBUTE]

	if (useCustomRecordsIds && testIdAttribute && testIdAttribute.value) return testIdAttribute.value
	return crypto.randomUUID()
}

function getFilteredAttributes(params: {
	attributes: Record<string, sax.QualifiedAttribute>
	useCustomRecordsIds: boolean
}): sax.QualifiedAttribute[] {
	const { attributes, useCustomRecordsIds } = params

	if (useCustomRecordsIds)
		return Object.values(attributes).filter((attr) => attr.name !== CUSTOM_RECORD_ID_ATTRIBUTE)
	return Object.values(attributes)
}
