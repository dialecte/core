import { getRecord } from './get-record'
import { getRecords } from './get-records'

import type { Context } from '@/document'
import type { AnyDialecteConfig, ChildrenOf, ElementsOf, TrackedRecord, RefOrRecord } from '@/types'

/**
 * Fetch all direct children of a parent matching a given tag name.
 *
 * When no direct match is found and the config declares `transparentElements`,
 * looks through those wrapper elements to find matching children one level deeper.
 *
 * Returns an empty array when the parent does not exist or has no matching children.
 */
export async function getChildren<
	GenericConfig extends AnyDialecteConfig,
	GenericElement extends ElementsOf<GenericConfig>,
	GenericChildElement extends ChildrenOf<GenericConfig, GenericElement>,
>(params: {
	context: Context<GenericConfig>
	ref: RefOrRecord<GenericConfig, GenericElement>
	tagName: GenericChildElement
}): Promise<TrackedRecord<GenericConfig, GenericChildElement>[]> {
	const { context, ref, tagName } = params

	const parent = await getRecord({ context, ref })
	if (!parent) return []

	const childRefs = parent.children
		.filter((child) => child.tagName === tagName)
		.map((child) => ({ tagName, id: child.id }))

	if (childRefs.length) {
		const resolved = await getRecords({ context, refs: childRefs })
		return resolved.filter(
			(record): record is TrackedRecord<GenericConfig, GenericChildElement> => record !== undefined,
		)
	}

	// Look through transparent elements
	const transparentElements = context.dialecteConfig.transparentElements
	if (!transparentElements?.length) return []

	const transparentRefs = parent.children.filter((child) =>
		transparentElements.includes(child.tagName),
	)
	if (!transparentRefs.length) return []

	const transparentRecords = await getRecords({ context, refs: transparentRefs })
	const collectedRefs = transparentRecords
		.filter((record) => record !== undefined)
		.flatMap((record) => record.children.filter((child) => child.tagName === tagName))
		.map((child) => ({ tagName, id: child.id }))

	if (!collectedRefs.length) return []

	const resolved = await getRecords({ context, refs: collectedRefs })
	return resolved.filter(
		(record): record is TrackedRecord<GenericConfig, GenericChildElement> => record !== undefined,
	)
}
