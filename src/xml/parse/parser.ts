import { SAX_PARSER_OPTIONS } from './parser.constants'
import { createPendingChildren } from './pending-children'

import * as sax from 'sax'

import { throwDialecteError } from '@/errors'
import { CUSTOM_RECORD_ID_ATTRIBUTE, standardizeRecord } from '@/helpers'
import { describePlace, findNotXmlCharacterInText } from '@/helpers/assert-xml-characters'
import { NOOP_PERF } from '@/perf'
import { invariant } from '@/utils'
import { notXmlCharacterOf } from '@/utils/xml-characters'
import { readXmlTextRun } from '@/utils/xml-whitespace'
import { withCanonicalXsiType } from '@/utils/xsi-type'

import type { PendingChildrenOfParse } from './pending-children.types'
import type { ParserInstance, ParserState } from './types'
import type { Perf } from '@/perf'
import type {
	Namespace,
	AnyDialecteConfig,
	AnyRawRecord,
	AnyQualifiedAttribute,
	AnyAttribute,
	AnyRelationship,
	ImportSession,
	TransactionHooks,
} from '@/types'

//====== PUBLIC FUNCTIONS ======//

/**
 * Sets up the SAX parser for XML parsing.
 * @param namespaces Namespace configuration from dialecte
 * @param useCustomRecordsIds Whether to use custom record IDs from the XML attributes
 * @returns SAX parser instance, whose drained batches hold the children a record waited for
 */
export function setSaxParser(params: {
	dialecteConfig: AnyDialecteConfig
	useCustomRecordsIds: boolean
	/** The record hooks standardization applies; the per-record io hook is the import session's */
	hooks?: TransactionHooks<AnyDialecteConfig>
	importSession?: ImportSession
	perf?: Perf
}): ParserInstance {
	const { dialecteConfig, useCustomRecordsIds, hooks, importSession, perf = NOOP_PERF } = params
	// The children whose parent left the stack before they closed: this parse's own
	const pendingChildren = createPendingChildren()

	// Single closure-private state, mutated in place per SAX event. The parser is
	// the sole sequential writer, so immutable rebuilds bought nothing and cost an
	// allocation (+ GC) per node — see handleOpenTag/handleCloseTag.
	const state: ParserState = {
		defaultNamespace: null,
		stack: [],
		recordsBatch: [],
		sawRoot: false,
	}

	const parser = sax.parser(true /* strict mode */, SAX_PARSER_OPTIONS)

	// The records the session asks for, when it names them: the others pass it by.
	const sessionTags = importSession?.recordTagNames && new Set(importSession.recordTagNames)

	parser.onopentag = (node: sax.QualifiedTag) => {
		handleOpenTag({ node, state, dialecteConfig, useCustomRecordsIds })
	}

	parser.ontext = (text: string) => {
		handleText({ text, state })
	}

	parser.oncdata = (cdata: string) => {
		appendValue({ text: cdata, state })
	}

	parser.onclosetag = () => {
		handleCloseTag({
			state,
			hooks,
			importSession,
			sessionTags,
			pendingChildren,
			dialecteConfig,
			perf,
		})
	}

	parser.onerror = handleError

	function drainBatch() {
		const snapshot = state.recordsBatch
		state.recordsBatch = []
		return pendingChildren.resolve({ batch: snapshot })
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

	if (state.stack.length === 0) {
		if (state.sawRoot) {
			throwDialecteError('PARSE_ERROR', {
				detail: `XML parsing error: a second root element <${node.name}> after the root was closed`,
				meta: { reason: 'second-root', tagName: node.name },
			})
		}
		state.sawRoot = true
	}

	if (!state.defaultNamespace)
		state.defaultNamespace = getDefaultNamespace({
			element: node,
			defaultNamespace: dialecteConfig.namespaces.default,
			rootElementName: dialecteConfig.rootElementName,
		})

	const documentDefault = state.defaultNamespace
	const namespace = getElementNamespace({ element: node, defaultNamespace: documentDefault })

	const id = getElementId({ attributes: node.attributes, useCustomRecordsIds, tagName })
	const filteredAttributes = getFilteredAttributes({
		attributes: node.attributes,
		useCustomRecordsIds,
	})

	assertDeclaredNamespacesCharacters({ attributes: node.attributes, tagName })

	// the xsi:type value read with the namespaces in scope here (an ancestor's bindings too), stored canonical
	const attributes = withCanonicalXsiType({
		dialecteConfig,
		attributes: getElementAttributes(filteredAttributes),
		namespaceOf: (prefix) => namespaceInScope({ node, prefix, documentDefault }),
	})
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
 * Handles the text event: a run of text between two markup events, trimmed of XML whitespace (space, tab,
 * carriage return, line feed) and each inner run of it written as one space; every other character is kept.
 * @param text The run of text, as written
 * @param state Current state
 */
function handleText(params: { text: string; state: ParserState }): void {
	const { state } = params
	appendValue({ text: readXmlTextRun({ text: params.text }), state })
}

/**
 * Appends text to the open element's value (CDATA as written).
 * @param text Text content of the current element
 * @param state Current state
 */
function appendValue(params: { text: string; state: ParserState }): void {
	const { text, state } = params

	if (!text) return
	if (state.stack.length > 0) state.stack[state.stack.length - 1].value += text
}

/**
 * A record read from the file holds XML characters only - its value, its namespace URI, its attributes' values and
 * namespace URIs, as the file and the hooks gave them -, else the file fails: sax reads a control character below
 * U+0020 but tab, line feed and carriage return, U+FFFE or U+FFFF, written or as a character reference, which XML
 * does not allow. Its names are not read here: sax reads the file's names as XML names; one a hook writes is
 * refused by the writer.
 */
function assertParsedXmlCharacters(params: { record: AnyRawRecord }): void {
	const { record } = params
	const found = findNotXmlCharacterInText({ record })
	if (!found) return
	const place = describePlace({ place: found, element: `<${record.tagName}>` })
	throwNotXmlCharacter({ character: found.character, where: place })
}

function throwNotXmlCharacter(params: { character: string; where: string }): never {
	const { character, where } = params
	throwDialecteError('PARSE_ERROR', {
		detail: `XML parsing error: ${where} holds ${character}, a character XML does not allow (as written or as a character reference)`,
		meta: { reason: 'not-xml-character', character },
	})
}

/**
 * Handles the closing tag event.
 * @param state Current state
 * @param pendingChildren The parse's children whose parent left the stack before they closed
 * @param hooks Dialecte record hooks (standardization), from the Project instance
 * @param importSession This file's import session, when the dialecte creates one
 * @param sessionTags The tag names the session asks for; absent, every record is handed to it
 * @returns Updated state
 */
function handleCloseTag(params: {
	state: ParserState
	pendingChildren: PendingChildrenOfParse
	hooks?: TransactionHooks<AnyDialecteConfig>
	importSession?: ImportSession
	sessionTags?: ReadonlySet<string>
	dialecteConfig: AnyDialecteConfig
	perf?: Perf
}): void {
	const {
		state,
		hooks,
		importSession,
		sessionTags,
		pendingChildren,
		dialecteConfig,
		perf = NOOP_PERF,
	} = params

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
	const currentRecord = perf.time('import::standardize', () =>
		standardizeRecord({
			dialecteConfig,
			hooks,
			record: rawRecord,
		}),
	)

	const beforeImportRecord = importSession?.beforeImportRecord
	if (beforeImportRecord && (!sessionTags || sessionTags.has(currentRecord.tagName))) {
		perf.time('import::hooks.record', () =>
			beforeImportRecord({ record: currentRecord, ancestry: state.stack }),
		)
	}
	assertParsedXmlCharacters({ record: currentRecord })

	const parent = state.stack[state.stack.length - 1]
	if (parent) {
		// Mutate the still-open parent's children in place; it captures them when it
		// standardizes on its own close.
		parent.children.push({ id: currentRecord.id, tagName: currentRecord.tagName })
	} else if (currentRecord.parent) {
		// Parent already left the stack (drained in an earlier batch) → resolve later.
		pendingChildren.register({
			parentId: currentRecord.parent.id,
			child: { id: currentRecord.id, tagName: currentRecord.tagName },
		})
	}

	state.recordsBatch.push(currentRecord)
}

/**
 * A SAX error is the file's: thrown as `PARSE_ERROR` from the handler, so `parser.write` rejects the
 * import with it (sax itself only records the error and keeps going).
 * @param error SAX parser error
 */
function handleError(error: Error): never {
	throwDialecteError('PARSE_ERROR', {
		detail: `XML parsing error: ${error.message}`,
		meta: { reason: 'malformed-xml', parser: error.message },
	})
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

/**
 * The namespace an element is in, as resolved where it stands: a prefixed name takes its prefix's binding; an
 * unprefixed one the default namespace in scope (`xmlns="urn:f"` on a subtree, no namespace under `xmlns=""`). A
 * document that declares no default at all keeps its unprefixed elements in the dialecte's default namespace.
 */
function getElementNamespace(params: {
	element: sax.QualifiedTag
	defaultNamespace: Namespace
}): Namespace {
	const { element, defaultNamespace } = params
	// sax refuses a prefix bound nowhere: a prefixed name always has its namespace
	if (element.prefix) return { prefix: element.prefix, uri: element.uri }
	const inScope: string | undefined = element.ns['']
	if (inScope === undefined) return defaultNamespace
	return { prefix: '', uri: inScope }
}

function getElementAttributes(
	attributes: sax.QualifiedAttribute[],
): (AnyAttribute | AnyQualifiedAttribute)[] {
	// namespace declarations (xmlns, xmlns:*) are no attribute of a record, the root's included: the xsi:type value
	// is resolved with them in scope (withCanonicalXsiType), and the export declares the namespaces it writes itself

	return attributes
		.filter((attribute) => attribute.prefix !== 'xmlns')
		.map((attribute) => {
			const namespace =
				!!attribute.prefix && !!attribute.uri
					? {
							prefix: attribute.prefix,
							uri: attribute.uri,
						}
					: undefined

			return {
				name: namespace ? attribute.local : attribute.name,
				value: attribute.value,
				...(namespace && { namespace }),
			}
		})
}

/** A declaration is stored nowhere, but its URI is written like any attribute value: one XML does not allow fails the file. */
function assertDeclaredNamespacesCharacters(params: {
	attributes: Record<string, sax.QualifiedAttribute>
	tagName: string
}): void {
	const { attributes, tagName } = params
	for (const attribute of Object.values(attributes)) {
		if (attribute.prefix !== 'xmlns') continue
		const character = notXmlCharacterOf({ text: attribute.value })
		if (!character) continue
		throwNotXmlCharacter({
			character,
			// the name as the file wrote it: `xmlns` or `xmlns:<prefix>`
			where: `The attribute ${attribute.name} of <${tagName}>`,
		})
	}
}

/**
 * The namespace a prefix names where the element stands, for a QName value: the in-scope bindings; the default
 * namespace, when a document declares none, is the one its unprefixed elements take (the dialecte's).
 */
function namespaceInScope(params: {
	node: sax.QualifiedTag
	prefix: string
	documentDefault: Namespace
}): string | undefined {
	const { node, prefix, documentDefault } = params
	const bound: string | undefined = node.ns[prefix]
	if (bound !== undefined || prefix !== '') return bound
	return documentDefault.uri
}

function getParent(stack: AnyRawRecord[]): AnyRelationship | null {
	if (stack.length === 0) return null
	const lastParent = stack[stack.length - 1]
	return lastParent ? { id: lastParent.id, tagName: lastParent.tagName } : null
}

/**
 * The record's id: the file's custom id attribute with `useCustomRecordsIds` (it is no attribute of the record then,
 * so its characters are checked here: one XML does not allow fails the file), else a new uuid.
 */
function getElementId(params: {
	attributes: Record<string, sax.QualifiedAttribute>
	useCustomRecordsIds: boolean
	tagName: string
}): string {
	const { attributes, useCustomRecordsIds, tagName } = params
	const testIdAttribute = attributes[CUSTOM_RECORD_ID_ATTRIBUTE]

	if (!useCustomRecordsIds || !testIdAttribute || !testIdAttribute.value) return crypto.randomUUID()
	const character = notXmlCharacterOf({ text: testIdAttribute.value })
	if (character) {
		throwNotXmlCharacter({
			character,
			where: `The attribute ${CUSTOM_RECORD_ID_ATTRIBUTE} of <${tagName}>`,
		})
	}
	return testIdAttribute.value
}

function getFilteredAttributes(params: {
	attributes: Record<string, sax.QualifiedAttribute>
	useCustomRecordsIds: boolean
}): sax.QualifiedAttribute[] {
	const { attributes, useCustomRecordsIds } = params

	if (useCustomRecordsIds)
		return Object.values(attributes).filter(
			(attribute) => attribute.name !== CUSTOM_RECORD_ID_ATTRIBUTE,
		)
	return Object.values(attributes)
}
