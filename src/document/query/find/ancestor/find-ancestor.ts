import { getRecord } from '../../get/record'

import type { FindAncestorsOptions } from './find-ancestor.types'
import type { Context } from '@/document'
import type { AnyDialecteConfig, ElementsOf, TrackedRecord, Ref } from '@/types'
/**
 * Walk the parent chain from a record upward.
 *
 * Returns ancestors bottom-up: [parent, grandparent, …, root].
 * The starting record is NOT included.
 * When `stopAtTagName` is set, the walk stops after collecting that element (inclusive).
 * When `depth` is set, at most that many ancestors are returned.
 */
export async function findAncestors<
	GenericConfig extends AnyDialecteConfig,
	GenericElement extends ElementsOf<GenericConfig>,
>(params: {
	context: Context<GenericConfig>
	ref: Ref<GenericConfig, GenericElement>
	options?: FindAncestorsOptions<GenericConfig>
}): Promise<TrackedRecord<GenericConfig, ElementsOf<GenericConfig>>[]> {
	const { context, ref, options } = params
	const maxDepth = options?.depth ?? Infinity
	const stopAtTagName = options?.stopAtTagName

	const ancestors: TrackedRecord<GenericConfig, ElementsOf<GenericConfig>>[] = []

	let current: TrackedRecord<GenericConfig, ElementsOf<GenericConfig>> | undefined =
		await getRecord({ context, ref })

	while (current?.parent && ancestors.length < maxDepth) {
		const parentRef = current.parent as Ref<GenericConfig, ElementsOf<GenericConfig>>
		const parentRecord: TrackedRecord<GenericConfig, ElementsOf<GenericConfig>> | undefined =
			await getRecord({ context, ref: parentRef })
		if (!parentRecord) break

		ancestors.push(parentRecord)

		if (stopAtTagName && parentRecord.tagName === stopAtTagName) break

		current = parentRecord
	}

	return ancestors
}
