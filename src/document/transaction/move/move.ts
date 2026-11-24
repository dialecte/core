import { stageOperations } from '../stage-operations'

import { findAncestors, getRecord, getRecords } from '@/document'
import { toRawRecord, toRef } from '@/helpers'
import { childOccurrences, invariant, resolveDefinition } from '@/utils'

import type { AnyRefOf } from './move.types'
import type { Context, Ref } from '@/document'
import type {
	AnyDialecteConfig,
	AnyRelationship,
	AnyTrackedRecord,
	ElementsOf,
	Operation,
	RawRecord,
} from '@/types'

/**
 * Stages the move of a record and its subtree under another parent of the same document: the record's
 * `parent` and both parents' `children` change, record ids are kept. Under the same parent it is a reorder
 * (one parent update); to the place the record holds, nothing is staged. Reads go through the staged lookup.
 *
 * @internal the staging step behind `tx.move`; callers use the transaction
 */
export async function stageMove<
	GenericConfig extends AnyDialecteConfig,
	GenericElement extends ElementsOf<GenericConfig>,
>(params: {
	context: Context<GenericConfig>
	ref: Ref<GenericConfig, GenericElement>
	parentRef: AnyRefOf<GenericConfig>
	beforeRef: AnyRefOf<GenericConfig> | undefined
}): Promise<RawRecord<GenericConfig, GenericElement>> {
	const { context, ref, parentRef, beforeRef } = params
	const [record, newParent] = await getRecords({
		context,
		refs: [ref as AnyRefOf<GenericConfig>, parentRef],
	})
	invariant(record, {
		detail: `Record to move not found (tagName=${ref.tagName}, id=${ref.id})`,
		key: 'ELEMENT_NOT_FOUND',
		ref,
	})
	invariant(record.parent, { detail: 'Cannot move the root element', key: 'PROTECTED_ROOT' })
	invariant(newParent, {
		detail: `New parent not found (tagName=${parentRef.tagName}, id=${parentRef.id})`,
		key: 'ELEMENT_NOT_FOUND',
		ref: parentRef,
	})
	assertParentAdmits({ context, record, newParent })
	await assertNotIntoOwnSubtree({ context, record, newParent })
	assertBeforeIsSibling({ record, newParent, beforeRef })

	const unmoved = toRawRecord(record) as RawRecord<GenericConfig, GenericElement>
	const sameParent = newParent.id === record.parent.id
	if (sameParent && beforeRef?.id === record.id) return unmoved

	const children = placeAmongChildren({ record, newParent, beforeRef })
	if (sameParent) {
		if (!sameTagOrder({ tagName: record.tagName, left: children, right: newParent.children }))
			stageOperations({
				context,
				operations: [updated({ record: newParent, change: { children } })],
			})
		return unmoved
	}

	const oldParent = await getRecord({ context, ref: toRef(record.parent) })
	invariant(oldParent, {
		detail: `Parent of the moved record not found (tagName=${record.parent.tagName}, id=${record.parent.id})`,
		key: 'ELEMENT_NOT_FOUND',
	})
	const parent = { id: newParent.id, tagName: newParent.tagName }
	stageOperations({
		context,
		operations: [
			updated({ record, change: { parent } }),
			updated({
				record: oldParent,
				change: { children: oldParent.children.filter((child) => child.id !== record.id) },
			}),
			updated({ record: newParent, change: { children } }),
		],
	})
	return { ...unmoved, parent } as RawRecord<GenericConfig, GenericElement>
}

/**
 * The new parent's definition must hold the moved tag (a wildcard parent admits any tag), and hold fewer children of
 * that tag than it may: the moved record is not counted when it stays under that parent.
 */
function assertParentAdmits<GenericConfig extends AnyDialecteConfig>(params: {
	context: Context<GenericConfig>
	record: AnyTrackedRecord<GenericConfig>
	newParent: AnyTrackedRecord<GenericConfig>
}): void {
	const { context, record, newParent } = params
	const parentRef = { tagName: newParent.tagName, id: newParent.id }
	const definition = resolveDefinition({
		dialecteConfig: context.dialecteConfig,
		record: newParent,
	})
	const admitted =
		definition !== undefined &&
		(definition.children.any === true || definition.children.sequence.includes(record.tagName))
	invariant(admitted, {
		detail: `${newParent.tagName} may not hold ${record.tagName}`,
		key: 'INVALID_PARENT_CHILD',
		ref: parentRef,
	})

	const max = childOccurrences({ definition })[record.tagName]?.max
	if (max === undefined) return
	const held = newParent.children.filter(
		(child) => child.tagName === record.tagName && child.id !== record.id,
	).length
	invariant(held < max, {
		detail: `${newParent.tagName} already holds ${held} ${record.tagName}, the most it may`,
		key: 'MAX_OCCURRENCES_REACHED',
		ref: parentRef,
	})
}

/** The new parent may be neither the moved record nor below it: one walk up from the new parent. */
async function assertNotIntoOwnSubtree<GenericConfig extends AnyDialecteConfig>(params: {
	context: Context<GenericConfig>
	record: AnyTrackedRecord<GenericConfig>
	newParent: AnyTrackedRecord<GenericConfig>
}): Promise<void> {
	const { context, record, newParent } = params
	if (newParent.id === record.parent?.id) return
	const inside =
		newParent.id === record.id ||
		// every stored ancestor: a transparent element moved under its own descendant is still found
		(
			await findAncestors({
				context,
				ref: toRef(newParent) as AnyRefOf<GenericConfig>,
				options: { unwrap: [] },
			})
		).some((ancestor) => ancestor.id === record.id)
	invariant(!inside, {
		detail: `Cannot move ${record.tagName} under itself or one of its descendants (${newParent.tagName} ${newParent.id})`,
		key: 'MOVE_INTO_OWN_SUBTREE',
		ref: { tagName: record.tagName, id: record.id },
	})
}

/** `before`, when given, must be a child of the new parent with the moved record's tag. */
function assertBeforeIsSibling<GenericConfig extends AnyDialecteConfig>(params: {
	record: AnyTrackedRecord<GenericConfig>
	newParent: AnyTrackedRecord<GenericConfig>
	beforeRef: AnyRefOf<GenericConfig> | undefined
}): void {
	const { record, newParent, beforeRef } = params
	if (beforeRef === undefined) return
	const sibling =
		beforeRef.tagName === record.tagName &&
		newParent.children.some(
			(child) => child.id === beforeRef.id && child.tagName === record.tagName,
		)
	invariant(sibling, {
		detail: `${beforeRef.tagName} ${beforeRef.id} is no ${record.tagName} child of ${newParent.tagName} ${newParent.id}`,
		key: 'MOVE_BEFORE_NOT_SIBLING',
		ref: { tagName: beforeRef.tagName, id: beforeRef.id },
	})
}

/**
 * The new parent's children with the moved record placed: right before `before`, else right after the last child of
 * its tag, else last.
 */
function placeAmongChildren<GenericConfig extends AnyDialecteConfig>(params: {
	record: AnyTrackedRecord<GenericConfig>
	newParent: AnyTrackedRecord<GenericConfig>
	beforeRef: AnyRefOf<GenericConfig> | undefined
}): AnyRelationship[] {
	const { record, newParent, beforeRef } = params
	const others = newParent.children.filter((child) => child.id !== record.id)
	const lastOfTag = others.findLastIndex((child) => child.tagName === record.tagName)
	const afterTag = lastOfTag === -1 ? others.length : lastOfTag + 1
	const index =
		beforeRef === undefined ? afterTag : others.findIndex((child) => child.id === beforeRef.id)
	const moved = { id: record.id, tagName: record.tagName }
	return [...others.slice(0, index), moved, ...others.slice(index)]
}

/** Whether both children lists hold the children of that tag in the same order: the order an export keeps. */
function sameTagOrder(params: {
	tagName: string
	left: readonly AnyRelationship[]
	right: readonly AnyRelationship[]
}): boolean {
	const { tagName, left, right } = params
	const leftIds = idsOfTag({ tagName, children: left })
	const rightIds = idsOfTag({ tagName, children: right })
	return leftIds.length === rightIds.length && leftIds.every((id, index) => id === rightIds[index])
}

function idsOfTag(params: { tagName: string; children: readonly AnyRelationship[] }): string[] {
	const { tagName, children } = params
	return children.filter((child) => child.tagName === tagName).map((child) => child.id)
}

/** An `updated` operation: the record as read, then with the change applied. */
function updated<GenericConfig extends AnyDialecteConfig>(params: {
	record: AnyTrackedRecord<GenericConfig>
	change: Partial<Pick<AnyTrackedRecord<GenericConfig>, 'parent' | 'children'>>
}): Operation<GenericConfig> {
	const { record, change } = params
	return {
		status: 'updated',
		oldRecord: record,
		newRecord: { ...record, ...change },
	} as Operation<GenericConfig>
}
