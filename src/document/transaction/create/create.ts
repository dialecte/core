import { stageOperation, stageOperations } from '../stage-operations'

import { getRecord } from '@/document'
import { assertNoFixedViolation, assertXsiTypeAdmitted, standardizeRecord } from '@/helpers'
import { readAttributeInput } from '@/helpers/attribute-input'
import { invariant } from '@/utils'
import { assertXsiTypePrefixKnown } from '@/utils/xsi-type'

import type { AddChildParams, ChildAttributesOf } from './create.types'
import type { Context, Query, Ref } from '@/document'
import type {
	AnyDialecteConfig,
	AnyRawRecord,
	AttributeInputOf,
	AttributesValueObjectOf,
	ElementsOf,
	ChildrenOf,
	RawRecord,
	TransactionHooks,
} from '@/types'

/**
 * Fetches parent, builds and stages operations for adding a child.
 * Pushes operations directly to context.stagedOperations.log.
 *
 * @internal the staging step behind `tx.addChild`; callers use the transaction
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
	/**
	 * The attributes are a stored record's, copied as they are (a clone): their xsi:type value is not judged as an
	 * authored one. For records read from the store only. Default `false`.
	 */
	copiesStoredValues?: boolean
}): Promise<RawRecord<GenericConfig, GenericChildElement>> {
	const {
		dialecteConfig,
		hooks,
		context,
		query,
		parentRef,
		params: childParams,
		copiesStoredValues = false,
	} = params
	const { id, tagName, attributes, namespace, value } = childParams

	assertAuthoredAttributeNamesAreLocal({ dialecteConfig, attributes, tagName })

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

	assertChildRecordWritable({ dialecteConfig, record: childRecord, copiesStoredValues })

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
 * The write-path guards of a new child: no authored value violates a schema `fixed`; an authored xsi:type prefix is
 * one the engine table binds (a copied value stays as stored, even one import kept as written); an abstract type is
 * named, and only a type the element may take.
 */
function assertChildRecordWritable(params: {
	dialecteConfig: AnyDialecteConfig
	record: AnyRawRecord
	copiesStoredValues: boolean
}): void {
	const { dialecteConfig, record, copiesStoredValues } = params
	assertNoFixedViolation({ dialecteConfig, record, attributes: record.attributes })
	if (!copiesStoredValues) assertXsiTypePrefixKnown({ dialecteConfig, record })
	assertXsiTypeAdmitted({ dialecteConfig, record })
}

/**
 * Guard the authoring boundary: in the full-object form, an author supplies a *local* name plus a `namespace`, and
 * dialecte derives the stored `prefix:local` name; each input is read by `readAttributeInput` as authored (a prefix
 * baked into the name refused unless it is the canonical form, a namespace declaration or an unknown namespace key
 * refused). The value-object form keeps its canonical (possibly prefixed) keys - the generated, discoverable names -
 * so it is not checked here.
 */
function assertAuthoredAttributeNamesAreLocal<
	GenericConfig extends AnyDialecteConfig,
	GenericChildElement extends ElementsOf<GenericConfig>,
>(params: {
	dialecteConfig: GenericConfig
	attributes: ChildAttributesOf<GenericConfig, GenericChildElement> | undefined
	tagName: GenericChildElement
}): void {
	const { dialecteConfig, attributes, tagName } = params
	if (!attributes || !Array.isArray(attributes)) return
	for (const attribute of attributes)
		readAttributeInput({ dialecteConfig, attribute, tagName, authored: true })
}
