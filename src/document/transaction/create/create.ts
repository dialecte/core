import { stageOperation, stageOperations } from '../stage-operations'

import { getRecord } from '@/document'
import { throwDialecteError } from '@/errors'
import { assertNoFixedViolation, standardizeRecord } from '@/helpers'
import { extractLocalName, invariant } from '@/utils'

import type { AddChildParams, ChildAttributesOf } from './create.types'
import type { Context, Query, Ref } from '@/document'
import type {
	AnyDialecteConfig,
	AttributeInputOf,
	AttributesValueObjectOf,
	ElementsOf,
	ChildrenOf,
	RawRecord,
	TransactionHooks,
} from '@/types'

/**
 * Fetches parent, builds and stages operations for adding a child.
 * Pushes operations directly to context.stagedOperations.
 */
export async function stageAddChild<
	GenericConfig extends AnyDialecteConfig,
	GenericElement extends ElementsOf<GenericConfig>,
	GenericChildElement extends ChildrenOf<GenericConfig, GenericElement>,
>(params: {
	dialecteConfig: GenericConfig
	hooks?: TransactionHooks<GenericConfig>
	context: Context<GenericConfig>
	query: Query<GenericConfig>
	parentRef: Ref<GenericConfig, GenericElement>
	params: AddChildParams<GenericConfig, GenericElement, GenericChildElement>
}): Promise<RawRecord<GenericConfig, GenericChildElement>> {
	const { dialecteConfig, hooks, context, query, parentRef, params: childParams } = params
	const { id, tagName, attributes, namespace, value } = childParams

	assertAuthoredAttributeNamesAreLocal({ attributes, tagName })

	const parentRecord = await getRecord({ context, ref: parentRef })
	invariant(parentRecord, {
		detail: 'Parent record not found',
		key: 'ELEMENT_NOT_FOUND',
		ref: parentRef,
	})

	const childRecord = standardizeRecord({
		dialecteConfig,
		hooks,
		record: {
			id: id ?? crypto.randomUUID(),
			tagName,
			// `ChildAttributesOf` restricts the value-object form to default-namespace
			// attributes and the array form to authored (local-name + namespace) attrs;
			// both are accepted by `standardizeRecord`, but TS can't prove the mapped-type
			// subset relationship generically, so widen here to the standardize input.
			attributes: attributes as
				| Partial<AttributesValueObjectOf<GenericConfig, GenericChildElement>>
				| AttributeInputOf<GenericConfig, GenericChildElement>[],
			namespace,
			value,
			parent: { id: parentRecord.id, tagName: parentRecord.tagName },
			children: [],
		},
	})

	// Write-path guard: reject an authored value that violates a schema `fixed`.
	assertNoFixedViolation({
		dialecteConfig,
		tagName: childRecord.tagName,
		attributes: childRecord.attributes,
	})

	stageOperation({
		context,
		status: 'created',
		record: childRecord,
	})

	const updatedParent: RawRecord<GenericConfig, GenericElement> = {
		...parentRecord,
		children: [...parentRecord.children, { id: childRecord.id, tagName: childRecord.tagName }],
	}

	stageOperation({
		context,
		status: 'updated',
		oldRecord: parentRecord,
		newRecord: updatedParent,
	})

	if (hooks?.afterCreated) {
		const hookOperations = await hooks.afterCreated({
			childRecord,
			parentRecord: updatedParent,
			query,
		})
		stageOperations({ context, operations: hookOperations })
	}

	return childRecord
}

/**
 * Guard the authoring boundary: in the full-object form, an author supplies a
 * *local* name plus a `namespace`, and dialecte derives the stored `prefix:local`
 * name. A prefix baked into the name is ambiguous (which wins, name or namespace?)
 * so we reject it loudly rather than silently re-deriving. `xmlns`/`xmlns:*`
 * declarations are exempt. The value-object form keeps its canonical (possibly
 * prefixed) keys — those are the generated, discoverable names — so it is not checked.
 *
 * Exception: a prefixed name whose `namespace.prefix` already agrees with it is not
 * ambiguous — it is the canonical stored form (every namespaced attribute is stamped
 * `prefix:local` at standardize time), so a clone replaying an already-standardized
 * `RawRecord` through this same param shape must pass unchanged.
 */
function assertAuthoredAttributeNamesAreLocal<
	GenericConfig extends AnyDialecteConfig,
	GenericChildElement extends ElementsOf<GenericConfig>,
>(params: {
	attributes: ChildAttributesOf<GenericConfig, GenericChildElement> | undefined
	tagName: GenericChildElement
}): void {
	const { attributes, tagName } = params
	if (!attributes || !Array.isArray(attributes)) return

	for (const attribute of attributes) {
		const { name, namespace } = attribute
		const isXmlnsDeclaration = name === 'xmlns' || name.startsWith('xmlns:')
		if (isXmlnsDeclaration || !name.includes(':')) continue

		const isConsistentCanonicalForm =
			typeof namespace === 'object' && namespace?.prefix === name.slice(0, name.indexOf(':'))
		if (isConsistentCanonicalForm) continue

		throwDialecteError('PREFIXED_ATTRIBUTE_NAME', {
			detail: `Attribute '${name}' on '${tagName}' is prefixed — pass a local name plus its namespace instead: { name: '${extractLocalName(name)}', namespace }.`,
			ref: { tagName },
		})
	}
}
