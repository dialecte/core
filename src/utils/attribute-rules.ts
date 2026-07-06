import type { AnyDialecteConfig, Namespace } from '@/types'

/**
 * Schema-derived facts about a single attribute of an element.
 *
 * Single source of truth shared by `standardizeRecord` (which builds the
 * canonical stored form) and export's `shouldSkipDefaultAttribute` (which
 * shapes output). Centralizing the schema reads here keeps the two paths from
 * silently drifting apart — the analog of `orderByConfigSequence` for the
 * "which attributes belong, in what shape" question.
 */
export type AttributeRules = {
	/** The tag is a known dialecte element with a definition. */
	isKnownElement: boolean
	/** The attribute is declared in the element's schema. */
	isDefined: boolean
	/** The attribute is required by the schema. */
	isRequired: boolean
	/** The attribute is part of the element's identity (key/unique) fields. */
	isIdentityField: boolean
	/** Schema fixed value, if any (takes precedence over default). */
	fixed: string | undefined
	/** Schema default value, if any. */
	default: string | undefined
	/** Schema-declared namespace for the attribute, if any. */
	namespace: Namespace | undefined
}

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

/** Local part of an attribute name — strips a namespace prefix if present (`a:b` → `b`). */
export function extractLocalName(name: string): string {
	const colonIndex = name.lastIndexOf(':')
	return colonIndex === -1 ? name : name.slice(colonIndex + 1)
}

/**
 * Resolve a namespace declared in the config by its prefix (e.g. `xsi`,
 * `eIEC61850-6-100`). Returns `undefined` for an empty prefix or an unknown one —
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
