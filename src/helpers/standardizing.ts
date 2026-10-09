import { toFullAttributeArray } from './converter'

import { orderAttributesBySequence } from '@/utils'
import { resolveDefinition } from '@/utils/resolve-definition'

import type {
	AnyDialecteConfig,
	AttributeInputOf,
	ElementsOf,
	RawRecord,
	AttributesValueObjectOf,
	TransactionHooks,
} from '@/types'

export function standardizeRecord<
	GenericConfig extends AnyDialecteConfig,
	GenericElement extends ElementsOf<GenericConfig>,
>(params: {
	dialecteConfig: GenericConfig
	hooks?: TransactionHooks<GenericConfig>
	record: {
		tagName: GenericElement
		attributes?:
			| Partial<AttributesValueObjectOf<GenericConfig, GenericElement>>
			| AttributeInputOf<GenericConfig, GenericElement>[]
	} & Omit<Partial<RawRecord<GenericConfig, GenericElement>>, 'attributes'>
}): RawRecord<GenericConfig, GenericElement> {
	const { dialecteConfig, hooks, record } = params
	const { id, tagName, attributes, namespace, value } = record

	const recordId = id ?? crypto.randomUUID()

	const attributesArray = attributes
		? toFullAttributeArray({ tagName, attributes, dialecteConfig })
		: []

	const inputRecord: RawRecord<GenericConfig, GenericElement> = {
		id: recordId,
		tagName,
		attributes: attributesArray,
		namespace: namespace ?? {
			prefix: 'prefixNeededForNotSupportedNamespace',
			uri: 'uriNeededForNotSupportedNamespace',
		},
		value: value ?? '',
		parent: record.parent ?? null,
		children: record.children ?? [],
	}

	// Standardize only schema elements that live in a namespace the config declares.
	// An element whose local name collides with a schema element but lives in a foreign
	// namespace parses to the same `tagName`; matching on local name alone would overwrite
	// its namespace with the schema one and fill/drop its attributes. Guarding on the
	// namespace uri keeps such foreign records verbatim. Records with no namespace
	// (created/cloned) or in the default/registered namespaces still standardize.
	const knownNamespaceUris = Object.values(dialecteConfig.namespaces).map(({ uri }) => uri)
	const isForeignNamespace = namespace?.uri != null && !knownNamespaceUris.includes(namespace.uri)
	const isDialecteElement = dialecteConfig.elements.includes(tagName) && !isForeignNamespace

	if (!isDialecteElement) return inputRecord

	// as declared under this parent: a homonym's attributes differ from one parent to another; the namespace as
	// given - a created record has none yet, its parent decides it
	const definition = resolveDefinition({ dialecteConfig, record: { ...inputRecord, namespace } })
	const standardAttributeNames = definition?.attributes.sequence ?? []

	// Keep provided attributes only — the store stays faithful to the source, with one
	// normalization: an empty ('') or undefined value on a schema-managed attribute is
	// dropped. An empty carries no authored information — a `required` / `fixed` value is
	// re-materialized on export and a schema `default` (including '') is re-applied on
	// read/validation — so storing '' would be redundant and misread as a real value.
	// Schema-sequence attributes that are present with a value, plus any qualified
	// attribute (foreign-namespace or xmlns/xmlns:*), are retained; unqualified
	// non-schema attributes are dropped, unless the element's attribute wildcard admits
	// attributes in no namespace (`##any`, `##local`). Missing required/fixed/default attributes are
	// NOT synthesized here: schema values are materialized on export (required + fixed)
	// and surfaced on read (getAttribute/getAttributes effective view).
	const wildcard = definition?.attributes.any
	const admitsUnqualified =
		wildcard !== undefined &&
		(wildcard.namespace !== undefined
			? wildcard.namespace.includes('')
			: !(wildcard.notNamespace ?? []).includes(''))
	const keptAttributes = attributesArray.filter((attribute) => {
		const isSchemaAttribute = standardAttributeNames.includes(attribute.name)
		const isQualifiedExtra = 'namespace' in attribute && attribute.namespace != null
		if (!isSchemaAttribute && !isQualifiedExtra && !admitsUnqualified) return false

		const isEmptyValue =
			attribute.value === undefined || attribute.value === null || attribute.value === ''
		if (isSchemaAttribute && isEmptyValue) return false

		return true
	})

	// Two-rule convention: a default-namespace attribute is stored bare (no
	// namespace object). A caller may pass the default namespace explicitly (e.g.
	// a parsed record keyed by local name + default namespace); drop it so created
	// and imported forms of the same attribute are byte-identical.
	const defaultNamespaceUri = dialecteConfig.namespaces.default.uri
	const canonicalAttributes = keptAttributes.map((attribute) => {
		if ('namespace' in attribute && attribute.namespace?.uri === defaultNamespaceUri) {
			const { namespace: _defaultNamespace, ...bare } = attribute
			return bare as typeof attribute
		}
		return attribute
	})

	// An element's namespace can depend on its parent context: the same local name may be declared in
	// different namespaces under different parents (e.g. SCL `Labels` under `Substation` vs
	// `eIEC61850-6-100:Labels` under `DAS`). The declaration that applies says it; a record read in one of
	// the tag's namespaces keeps it (with the definition's prefix) even where its parent leaves the
	// declaration open; one read in a namespace none of its declarations uses keeps it too - the store stays
	// faithful to the source, validation reports it.
	const tagLevel = dialecteConfig.definition[tagName]
	const declaredNamespaces = [
		definition?.namespace ?? tagLevel.namespace,
		...Object.values(tagLevel.declarations ?? {}).map((declaration) => declaration.namespace),
	]
	const readNamespace = declaredNamespaces.find((declared) => declared.uri === namespace?.uri)

	let standardizedRecord: RawRecord<GenericConfig, GenericElement> = {
		...inputRecord,
		namespace: readNamespace ?? namespace ?? declaredNamespaces[0],
		attributes: orderAttributesBySequence(canonicalAttributes, standardAttributeNames),
	}

	if (hooks?.afterStandardizedRecord) {
		standardizedRecord = hooks.afterStandardizedRecord({
			record: standardizedRecord,
		})
		// The hook may append or move attributes (e.g. enforce a `uuid`), so
		// re-apply canonical ordering to keep records order-comparable regardless
		// of where the hook placed things. See [[attribute-rules]].
		standardizedRecord = {
			...standardizedRecord,
			attributes: orderAttributesBySequence(standardizedRecord.attributes, standardAttributeNames),
		}
	}

	return standardizedRecord
}
