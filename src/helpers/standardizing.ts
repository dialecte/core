import { toFullAttributeArray } from './converter'

import { getAttributeRules, orderAttributesBySequence } from '@/utils'

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

	const isDialecteElement = dialecteConfig.elements.includes(tagName)

	if (!isDialecteElement) return inputRecord

	const standardAttributeNames = dialecteConfig.definition[tagName].attributes.sequence

	const standardizedAttributes = standardAttributeNames.flatMap((attributeName) => {
		const rules = getAttributeRules({ dialecteConfig, tagName, attributeName })

		// Fixed values take precedence over defaults (XSD `fixed`); required
		// attributes fall back to '' so they are always present.
		const schemaValue = rules.fixed ?? rules.default
		const foundAttribute = attributesArray.find((attribute) => attribute.name === attributeName)
		const attributeValue =
			foundAttribute?.value ?? (rules.isRequired ? (schemaValue ?? '') : schemaValue)

		if (attributeValue === undefined) return []

		return [
			{
				name: attributeName,
				value: attributeValue,
				namespace: rules.namespace,
			},
		]
	})

	// Attributes outside the schema sequence (foreign-namespace attrs and
	// xmlns/xmlns:* declarations) are kept; unqualified non-schema attributes are
	// dropped. Ordering is applied below so the full array is order-canonical.
	const extraQualifiedAttributes = attributesArray.filter(
		(attribute) =>
			'namespace' in attribute &&
			attribute.namespace != null &&
			!standardAttributeNames.includes(attribute.name),
	)

	// An element's namespace can depend on its parent context: the same local name
	// may be declared in different namespaces under different parents (e.g. SCL
	// `Labels` under `Substation` vs `eIEC61850-6-100:Labels` under `DAS`). The
	// generated definition carries that override on the parent→child edge; fall back
	// to the element's own namespace when the edge omits one (or the record is a root).
	const parentTagName = record.parent?.tagName as ElementsOf<GenericConfig> | undefined
	const edgeNamespace = parentTagName
		? dialecteConfig.definition[parentTagName]?.children?.details?.[tagName]?.namespace
		: undefined

	let standardizedRecord: RawRecord<GenericConfig, GenericElement> = {
		...inputRecord,
		namespace: edgeNamespace ?? dialecteConfig.definition[tagName].namespace,
		attributes: orderAttributesBySequence(
			[...standardizedAttributes, ...extraQualifiedAttributes],
			standardAttributeNames,
		),
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
