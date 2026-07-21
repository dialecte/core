import type { AttributeDefaults, AttributeRules } from './attribute-rules.types'
import type { AnyDialecteConfig, Namespace } from '@/types'

export type { AttributeDefaults, AttributeRules } from './attribute-rules.types'

export function getAttributeRules(params: {
	dialecteConfig: AnyDialecteConfig
	tagName: string
	attributeName: string
}): AttributeRules {
	const { dialecteConfig, tagName, attributeName } = params

	const isKnownElement = dialecteConfig.elements.includes(tagName)
	const definition = isKnownElement ? dialecteConfig.definition[tagName] : undefined
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
	tagName: string
	attributeName: string
	defaults: AttributeDefaults
}): string | undefined {
	const { dialecteConfig, tagName, attributeName, defaults } = params
	if (defaults === 'none') return undefined

	const rules = getAttributeRules({ dialecteConfig, tagName, attributeName })

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
	tagName: string
	attributeName: string
	value: string
}): boolean {
	const { dialecteConfig, tagName, attributeName, value } = params
	const rules = getAttributeRules({ dialecteConfig, tagName, attributeName })
	const schemaValue = rules.fixed ?? rules.default
	return schemaValue !== undefined && value === schemaValue
}

/** Local part of an attribute name — strips a namespace prefix if present (`a:b` → `b`). */
export function extractLocalName(name: string): string {
	const colonIndex = name.lastIndexOf(':')
	return colonIndex === -1 ? name : name.slice(colonIndex + 1)
}

/**
 * Resolve a namespace declared in the config by its prefix (e.g. `ext`,
 * `dev`). Returns `undefined` for an empty prefix or an unknown one —
 * consumers cannot extend `config.namespaces`, so an unknown prefix is a caller error.
 */
export function resolveNamespaceByPrefix(
	dialecteConfig: AnyDialecteConfig,
	prefix: string,
): Namespace | undefined {
	if (!prefix) return undefined
	const namespaces = Object.values(dialecteConfig.namespaces) as Namespace[]
	return namespaces.find((namespace) => namespace.prefix === prefix)
}

/**
 * Resolve a namespace *scope* string to its full `Namespace`. A scope is normally a
 * `config.namespaces` key (e.g. `ext`, `dev`); as a fallback it is matched
 * against declared prefixes. Returns `undefined` when the scope is neither a known
 * key nor a known prefix — an authoring error, since a registered namespace must be
 * referenced by key (use a full `{ prefix, uri }` object for custom namespaces).
 */
export function resolveNamespaceByScope(
	dialecteConfig: AnyDialecteConfig,
	scope: string,
): Namespace | undefined {
	const namespaces = dialecteConfig.namespaces as Record<string, Namespace | undefined>
	return namespaces[scope] ?? resolveNamespaceByPrefix(dialecteConfig, scope)
}

/**
 * Resolve the XML prefix to store attributes under for a namespace *scope*.
 * The scope is normally a config namespace **key** (e.g. `ext`, `dev`), which we map
 * to its declared prefix. If the scope is not a declared key it is treated as a raw
 * prefix, so callers can still target custom namespaces the config is unaware of.
 */
export function resolvePrefixByNamespaceScope(
	dialecteConfig: AnyDialecteConfig,
	namespaceScope: string,
): string {
	return dialecteConfig.namespaces[namespaceScope]?.prefix ?? namespaceScope
}

/**
 * Stable, deterministic ordering for attributes that fall outside an element's
 * schema `sequence` (extra namespaced attributes: `xmlns`/`xmlns:*` and
 * foreign-namespace attributes). Sorted by namespace URI, then name, so two
 * records carrying the same attribute set compare equal regardless of the order
 * they were parsed, cloned, or updated in.
 */
export function compareQualifiedAttributes(
	a: { name: string; namespace?: Namespace },
	b: { name: string; namespace?: Namespace },
): number {
	const aUri = a.namespace?.uri ?? ''
	const bUri = b.namespace?.uri ?? ''
	if (aUri !== bUri) return aUri < bUri ? -1 : 1
	if (a.name !== b.name) return a.name < b.name ? -1 : 1
	return 0
}

/**
 * Put an element's attributes into canonical order: schema-sequence attributes
 * first (in `sequence` order), then everything else sorted deterministically.
 * Never drops attributes — reorders only — so it is safe to re-apply after an
 * `afterStandardizedRecord` hook to normalize whatever the hook added or moved.
 */
export function orderAttributesBySequence<
	GenericAttribute extends { name: string; namespace?: Namespace },
>(attributes: readonly GenericAttribute[], sequence: readonly string[]): GenericAttribute[] {
	const inSequence = sequence.flatMap((name) =>
		attributes.filter((attribute) => attribute.name === name),
	)
	const extras = attributes
		.filter((attribute) => !sequence.includes(attribute.name))
		.sort(compareQualifiedAttributes)

	return [...inSequence, ...extras]
}
