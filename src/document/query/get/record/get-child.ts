import { getRecord } from './get-record'

import type { Context } from '@/document'
import type { AnyDialecteConfig, ChildrenOf, ElementsOf, TrackedRecord, RefOrRecord } from '@/types'

/**
 * Fetch the first direct child of a parent matching a given tag name.
 *
 * When no direct match is found and the config declares `transparentElements`,
 * looks through those wrapper elements to find a matching child one level deeper.
 *
 * Returns `undefined` when the parent does not exist or has no matching child.
 */
export async function getChild<
	GenericConfig extends AnyDialecteConfig,
	GenericElement extends ElementsOf<GenericConfig>,
	GenericChildElement extends ChildrenOf<GenericConfig, GenericElement>,
>(params: {
	context: Context<GenericConfig>
	ref: RefOrRecord<GenericConfig, GenericElement>
	tagName: GenericChildElement
}): Promise<TrackedRecord<GenericConfig, GenericChildElement> | undefined> {
	const { context, ref, tagName } = params

	const parent = await getRecord({ context, ref })
	if (!parent) return undefined

	const child = parent.children.find((child) => child.tagName === tagName)
	if (child) return getRecord<GenericConfig, GenericChildElement>({ context, ref: child })

	// Look through transparent elements
	const transparentElements = context.dialecteConfig.transparentElements
	if (!transparentElements?.length) return undefined

	const transparentRefs = parent.children.filter((child) =>
		transparentElements.includes(child.tagName),
	)

	for (const transparentRef of transparentRefs) {
		const transparentRecord = await getRecord({ context, ref: transparentRef })
		if (!transparentRecord) continue

		const match = transparentRecord.children.find((child) => child.tagName === tagName)
		if (match) return getRecord<GenericConfig, GenericChildElement>({ context, ref: match })
	}

	return undefined
}
