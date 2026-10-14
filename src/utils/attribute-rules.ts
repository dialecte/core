import { resolveDefinition } from './resolve-definition'

import type { AttributeDefaults, AttributeRules } from './attribute-rules.types'
import type { ResolvableRecord } from './resolve-definition.types'
import type { AnyDialecteConfig } from '@/types'

export type { AttributeDefaults, AttributeRules } from './attribute-rules.types'

export function getAttributeRules(params: {
	dialecteConfig: AnyDialecteConfig
	/** The element and its parent: the rules are those of its definition there. */
	record: ResolvableRecord
	attributeName: string
}): AttributeRules {
	const { dialecteConfig, record, attributeName } = params

	const isKnownElement = dialecteConfig.elements.includes(record.tagName)
	const definition = isKnownElement ? resolveDefinition({ dialecteConfig, record }) : undefined
	const details = definition?.attributes.details[attributeName]

	return {
		isKnownElement,
		isDefined: !!details,
		isRequired: !!details?.required,
		isIdentityField: definition?.attributes.identityFields?.includes(attributeName) ?? false,
		fixed: details?.fixed,
		default: details?.default,
		namespace: details?.namespace || undefined,
	}
}

/**
 * The schema value to inject for an **absent** attribute, per the requested view.
 * Derived entirely from {@link getAttributeRules}, so read, compare, and export share
 * one source of truth. Returns `undefined` when nothing should be injected. A stored
 * value always wins and is handled by the caller before this is consulted.
 */
export function resolveSchemaAttributeValue(params: {
	dialecteConfig: AnyDialecteConfig
	record: ResolvableRecord
	attributeName: string
	defaults: AttributeDefaults
}): string | undefined {
	const { dialecteConfig, record, attributeName, defaults } = params
	if (defaults === 'none') return undefined

	const rules = getAttributeRules({ dialecteConfig, record, attributeName })

	if (defaults === 'required') {
		if (rules.isRequired || rules.fixed !== undefined) return rules.fixed ?? rules.default ?? ''
		return undefined
	}

	// 'optional' (read view)
	if (rules.fixed !== undefined) return rules.fixed
	if (rules.default) return rules.default
	return undefined
}

/**
 * Whether a value equals the attribute's schema default for COMPARE: matches the
 * `fixed` value if any, else the `default` (including an empty-string default).
 * Compare sites drop attributes for which this is true so that an authored
 * default-equal value and an absent attribute fold to the same thing.
 */
export function isSchemaDefaultValue(params: {
	dialecteConfig: AnyDialecteConfig
	record: ResolvableRecord
	attributeName: string
	value: string
}): boolean {
	const { dialecteConfig, record, attributeName, value } = params
	const rules = getAttributeRules({ dialecteConfig, record, attributeName })
	const schemaValue = rules.fixed ?? rules.default
	return schemaValue !== undefined && value === schemaValue
}

/** Local part of an attribute name — strips a namespace prefix if present (`a:b` → `b`). */
export function extractLocalName(name: string): string {
	const colonIndex = name.lastIndexOf(':')
	return colonIndex === -1 ? name : name.slice(colonIndex + 1)
}
