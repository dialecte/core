import { toFullAttributeArray } from './converter'

import type {
	AnyDialecteConfig,
	ElementsOf,
	FullAttributeObjectOf,
	RawRecord,
	AttributesValueObjectOf,
} from '@/types'

export function standardizeRecord<
	GenericConfig extends AnyDialecteConfig,
	GenericElement extends ElementsOf<GenericConfig>,
>(params: {
	record: {
		tagName: GenericElement
		attributes?:
			| AttributesValueObjectOf<GenericConfig, GenericElement>
			| FullAttributeObjectOf<GenericConfig, GenericElement>[]
	} & Partial<RawRecord<GenericConfig, GenericElement>>
	dialecteConfig: GenericConfig
}): RawRecord<GenericConfig, GenericElement> {
	const { record, dialecteConfig } = params
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
			foundAttribute?.value ||
			(attributeIsRequired ? details[attributeName]?.default || '' : undefined)

		if (attributeValue === undefined) return []

		return [
			{
				name: attributeName,
				value: attributeValue,
				namespace: attributeNamespace,
			},
		]
	})

	let standardizedRecord: RawRecord<GenericConfig, GenericElement> = {
		...inputRecord,
		namespace: dialecteConfig.definition[tagName].namespace,
		attributes: standardizedAttributes,
	}

	if (dialecteConfig.hooks?.afterStandardizedRecord) {
		standardizedRecord = dialecteConfig.hooks.afterStandardizedRecord({
			record: standardizedRecord,
		})
	}

	return standardizedRecord
}
