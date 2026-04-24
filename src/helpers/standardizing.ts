import { toFullAttributeArray } from './converter'

import type {
	AnyDialecteConfig,
	ElementsOf,
	FullAttributeObjectOf,
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
			| AttributesValueObjectOf<GenericConfig, GenericElement>
			| FullAttributeObjectOf<GenericConfig, GenericElement>[]
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
	const details = dialecteConfig.definition[tagName].attributes.details

	const standardizedAttributes = standardAttributeNames.flatMap((attributeName) => {
		const attributeIsRequired = details[attributeName].required
		const attributeNamespace = details[attributeName]?.namespace || undefined

		const foundAttribute = attributesArray.find((attribute) => attribute.name === attributeName)
		const attributeValue =
			foundAttribute?.value ??
			(attributeIsRequired
				? (details[attributeName]?.default ?? '')
				: details[attributeName]?.default)

		if (attributeValue === undefined) return []

		return [
			{
				name: attributeName,
				value: attributeValue,
				namespace: attributeNamespace,
			},
		]
	})

	const extraQualifiedAttributes = attributesArray.filter(
		(attribute) =>
			'namespace' in attribute &&
			attribute.namespace != null &&
			!standardAttributeNames.includes(attribute.name),
	)

	let standardizedRecord: RawRecord<GenericConfig, GenericElement> = {
		...inputRecord,
		namespace: dialecteConfig.definition[tagName].namespace,
		attributes: [...standardizedAttributes, ...extraQualifiedAttributes],
	}

	if (hooks?.afterStandardizedRecord) {
		standardizedRecord = hooks.afterStandardizedRecord({
			record: standardizedRecord,
		})
	}

	return standardizedRecord
}
