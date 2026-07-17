import { throwDialecteError } from '@/errors'
import {
	extractLocalName,
	invariant,
	resolveNamespaceByPrefix,
	resolveNamespaceByScope,
} from '@/utils'

import type { Ref, RefOrRecord } from '@/document'
import type {
	RawRecord,
	TrackedRecord,
	TreeRecord,
	AnyDialecteConfig,
	AttributeInputOf,
	ElementsOf,
	FullAttributeObjectOf,
	AttributesValueObjectOf,
	Namespace,
	OperationStatus,
	ParentRelationship,
	ChildRelationship,
} from '@/types'

/**
 * Converts a TrackedRecord | TreeRecord to RawRecord
 * If already a RawRecord, returns as-is.
 */
export function toRawRecord<
	GenericConfig extends AnyDialecteConfig,
	GenericElement extends ElementsOf<GenericConfig>,
>(
	record:
		| RawRecord<GenericConfig, GenericElement>
		| TrackedRecord<GenericConfig, GenericElement>
		| TreeRecord<GenericConfig, GenericElement>,
): RawRecord<GenericConfig, GenericElement> {
	return {
		id: record.id,
		tagName: record.tagName,
		namespace: record.namespace,
		attributes: record.attributes,
		value: record.value,
		parent: record.parent,
		children: record.children,
	}
}

/**
 * Converts a RawRecord | TreeRecord to TrackedRecord
 * If already a TrackedRecord, returns as-is.
 */
export function toTrackedRecord<
	GenericConfig extends AnyDialecteConfig,
	GenericElement extends ElementsOf<GenericConfig>,
>(params: {
	record:
		| RawRecord<GenericConfig, GenericElement>
		| TrackedRecord<GenericConfig, GenericElement>
		| TreeRecord<GenericConfig, GenericElement>
	status?: OperationStatus
}): TrackedRecord<GenericConfig, GenericElement> {
	const { record, status } = params
	const consolidatedStatus = status ?? ('status' in record ? record.status : 'unchanged')

	return {
		...toRawRecord(record),
		status: consolidatedStatus,
	}
}

/**
 * Converts a RawRecord | TrackedRecord to TreeRecord
 * If already a TreeRecord, returns as-is.
 */
export function toTreeRecord<
	GenericConfig extends AnyDialecteConfig,
	GenericElement extends ElementsOf<GenericConfig>,
>(params: {
	record:
		| RawRecord<GenericConfig, GenericElement>
		| TrackedRecord<GenericConfig, GenericElement>
		| TreeRecord<GenericConfig, GenericElement>
	status?: OperationStatus
	tree?: TreeRecord<GenericConfig, GenericElement>[]
}): TreeRecord<GenericConfig, GenericElement> {
	const { record, status, tree } = params

	const consolidatedTree = tree ?? ('tree' in record ? record.tree : [])

	return {
		...toTrackedRecord({ record, status }),
		tree: consolidatedTree,
	} as TreeRecord<GenericConfig, GenericElement>
}

/**
 * Converts attributes to FullAttributeObject array format and canonicalizes each
 * attribute name to the two naming rules (see `canonicalizeAttributeName`), so
 * records from import, create, and update share one stored name per attribute.
 */
export function toFullAttributeArray<
	GenericConfig extends AnyDialecteConfig,
	GenericElement extends ElementsOf<GenericConfig>,
>(params: {
	dialecteConfig: GenericConfig
	tagName: GenericElement
	attributes:
		| Partial<AttributesValueObjectOf<GenericConfig, GenericElement>>
		| AttributeInputOf<GenericConfig, GenericElement>[]
}): FullAttributeObjectOf<GenericConfig, GenericElement>[] {
	const { dialecteConfig, tagName, attributes } = params

	const rawArray = Array.isArray(attributes)
		? attributes
		: Object.entries(attributes).map(([name, value]) => ({
				name,
				value,
				namespace:
					dialecteConfig.definition[tagName]?.attributes.details[name]?.namespace || undefined,
			}))

	return rawArray.map((attribute) =>
		canonicalizeAttributeName({ attribute, dialecteConfig, tagName }),
	) as FullAttributeObjectOf<GenericConfig, GenericElement>[]
}

/**
 * Canonicalize an attribute's stored name to two predictable rules:
 *   - default namespace / unprefixed → bare local name (`aA`);
 *   - any non-default namespace → `prefix:local` (`ext:cA`, `dev:clone-index`).
 *
 * This mirrors the generated schema keys and XML export, so a namespaced attribute
 * read from a parsed document (stored by local name + namespace) ends up under the
 * same name it would have when created in-session. `xmlns`/`xmlns:*` declarations are
 * left verbatim. A namespace given as a registered *scope* string (a config key such
 * as `ext`) is resolved to its full `Namespace`. A prefixed name or an unresolvable
 * scope throws.
 */
function canonicalizeAttributeName(params: {
	attribute: { name: string; value: unknown; namespace?: Namespace | string }
	dialecteConfig: AnyDialecteConfig
	tagName: string
}): { name: string; value: unknown; namespace?: Namespace } {
	const { attribute, dialecteConfig, tagName } = params

	// A namespace supplied as a registered-scope string (config key or prefix) is
	// resolved to its full Namespace; an unknown scope is an authoring error.
	let namespace: Namespace | undefined
	if (typeof attribute.namespace === 'string') {
		namespace = resolveNamespaceByScope(dialecteConfig, attribute.namespace)
		if (!namespace) {
			throwDialecteError('UNKNOWN_NAMESPACE_PREFIX', {
				detail: `Unknown namespace '${attribute.namespace}' on attribute '${attribute.name}' — use a registered namespace key or pass a full { name, namespace: { prefix, uri } }.`,
				ref: { tagName },
			})
		}
	} else {
		namespace = attribute.namespace
	}

	// Resolve the namespace: carried on the attribute, else inferred from a prefixed
	// name via the config's declared namespaces (consumers can't extend that config,
	// so an unresolvable prefix is a caller error, not a silent drop).
	const colonIndex = attribute.name.indexOf(':')
	if (!namespace && colonIndex !== -1) {
		const prefix = attribute.name.slice(0, colonIndex)
		if (prefix !== 'xmlns') {
			namespace = resolveNamespaceByPrefix(dialecteConfig, prefix)
			if (!namespace) {
				throwDialecteError('UNKNOWN_NAMESPACE_PREFIX', {
					detail: `Unknown namespace prefix '${prefix}' on attribute '${attribute.name}' — pass it explicitly as { name, namespace: { prefix, uri } }.`,
					ref: { tagName },
				})
			}
		}
	}

	// Non-default namespace → always prefixed. Default/unprefixed and xmlns declarations
	// keep their name verbatim.
	if (namespace && namespace.prefix && namespace.prefix !== 'xmlns') {
		return {
			...attribute,
			name: `${namespace.prefix}:${extractLocalName(attribute.name)}`,
			namespace,
		}
	}
	return namespace === attribute.namespace
		? { ...attribute, namespace }
		: { ...attribute, namespace }
}

/**
 * Convert a Ref, ParentRelationship, ChildRelationship, or Record to a Ref.
 * ParentsOf/ChildrenOf are subsets of ElementsOf by design, so this is semantically safe.
 */
export function toRef<
	GenericConfig extends AnyDialecteConfig,
	GenericElement extends ElementsOf<GenericConfig>,
>(input: Ref<GenericConfig, GenericElement> | undefined): Ref<GenericConfig, GenericElement>
export function toRef<
	GenericConfig extends AnyDialecteConfig,
	GenericElement extends ElementsOf<GenericConfig>,
>(
	input:
		| ParentRelationship<GenericConfig, GenericElement>
		| ChildRelationship<GenericConfig, GenericElement>
		| undefined,
): Ref<GenericConfig, GenericElement>
export function toRef<
	GenericConfig extends AnyDialecteConfig,
	GenericElement extends ElementsOf<GenericConfig>,
>(
	input:
		| RawRecord<GenericConfig, GenericElement>
		| TrackedRecord<GenericConfig, GenericElement>
		| TreeRecord<GenericConfig, GenericElement>
		| undefined,
): Ref<GenericConfig, GenericElement>
export function toRef<
	GenericConfig extends AnyDialecteConfig,
	GenericElement extends ElementsOf<GenericConfig>,
>(input: RefOrRecord<GenericConfig, GenericElement> | undefined): Ref<GenericConfig, GenericElement>
export function toRef<
	GenericConfig extends AnyDialecteConfig,
	GenericElement extends ElementsOf<GenericConfig>,
>(
	input:
		| Ref<GenericConfig, GenericElement>
		| ParentRelationship<GenericConfig, GenericElement>
		| ChildRelationship<GenericConfig, GenericElement>
		| RawRecord<GenericConfig, GenericElement>
		| TrackedRecord<GenericConfig, GenericElement>
		| TreeRecord<GenericConfig, GenericElement>
		| undefined,
): Ref<GenericConfig, GenericElement> {
	invariant(input, {
		detail: 'The record or ref is undefined',
	})

	return {
		id: input.id,
		tagName: input.tagName as GenericElement,
	} as Ref<GenericConfig, GenericElement>
}
