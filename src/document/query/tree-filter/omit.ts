import { matchesAttributeFilter } from '../find'

import type { OmitEntry } from './types'
import type { AnyDialecteConfig, ElementsOf, TrackedRecord, TreeRecord } from '@/types'

/**
 * Compiled form of the user-facing `omit` array.
 *
 * - `unconditional` — tagNames omitted regardless of attributes (O(1) lookup).
 * - `conditional` — omit only when a record's attributes match `where`;
 *   `scope:'self'` drops the node, `scope:'children'` keeps it but stops below.
 */
export type OmitSpecification<GenericConfig extends AnyDialecteConfig> = {
	unconditional: Set<string>
	conditional: Array<{
		tagName: ElementsOf<GenericConfig>
		where: Record<string, unknown>
		scope: 'self' | 'children'
	}>
}

/**
 * Converts the user-facing `omit` array into a split structure for efficient traversal checks.
 *
 * Simple string entries go into `unconditional` (O(1) Set lookup).
 * Object entries with `where` conditions go into `conditional` (checked against record attributes).
 * This avoids re-parsing the omit array on every node visit.
 */
export function parseOmit<GenericConfig extends AnyDialecteConfig>(
	omit: OmitEntry<GenericConfig>[] | undefined,
): OmitSpecification<GenericConfig> {
	const unconditional = new Set<string>()
	const conditional: OmitSpecification<GenericConfig>['conditional'] = []

	if (!omit) return { unconditional, conditional }

	for (const entry of omit) {
		if (typeof entry === 'string') {
			unconditional.add(entry)
			continue
		}

		const tagName = Object.keys(entry)[0] as ElementsOf<GenericConfig>
		const config = (
			entry as Record<string, { where?: Record<string, unknown>; scope?: 'self' | 'children' }>
		)[tagName]

		if (!config?.where) {
			unconditional.add(tagName)
			continue
		}

		conditional.push({
			tagName,
			where: config.where as Record<string, unknown>,
			scope: config.scope ?? 'self',
		})
	}
	return { unconditional, conditional }
}

/**
 * Whether a node itself should be dropped (`scope:'self'` omit, conditional or
 * unconditional).
 */
export function isOmitted<GenericConfig extends AnyDialecteConfig>(params: {
	record: TrackedRecord<GenericConfig, ElementsOf<GenericConfig>>
	compiledOmit: OmitSpecification<GenericConfig>
}): boolean {
	const { record, compiledOmit } = params

	if (compiledOmit.unconditional.has(record.tagName)) return true

	return compiledOmit.conditional.some(
		(entry) =>
			entry.scope === 'self' &&
			entry.tagName === record.tagName &&
			matchesAttributeFilter({
				record,
				attributeFilter: entry.where as Parameters<
					typeof matchesAttributeFilter<GenericConfig, ElementsOf<GenericConfig>>
				>[0]['attributeFilter'],
			}),
	)
}

/**
 * Whether traversal should stop below a node (`scope:'children'` omit) — the
 * node is kept but its descendants are dropped.
 */
export function shouldStopTraversal<GenericConfig extends AnyDialecteConfig>(params: {
	record: TrackedRecord<GenericConfig, ElementsOf<GenericConfig>>
	compiledOmit: OmitSpecification<GenericConfig>
}): boolean {
	const { record, compiledOmit } = params

	return compiledOmit.conditional.some(
		(entry) =>
			entry.scope === 'children' &&
			entry.tagName === record.tagName &&
			matchesAttributeFilter({
				record,
				attributeFilter: entry.where as Parameters<
					typeof matchesAttributeFilter<GenericConfig, ElementsOf<GenericConfig>>
				>[0]['attributeFilter'],
			}),
	)
}

/**
 * Apply `omit` to an already-built tree (pure `TreeRecord → TreeRecord`).
 *
 * The root is never dropped (it is the queried element); omit is applied to its
 * descendants, mirroring `getTree`'s fetch-time pruning so both features share
 * the same semantics.
 */
export function applyOmit<
	GenericConfig extends AnyDialecteConfig,
	GenericElement extends ElementsOf<GenericConfig>,
>(params: {
	tree: TreeRecord<GenericConfig, GenericElement>
	omit: OmitEntry<GenericConfig>[] | undefined
}): TreeRecord<GenericConfig, GenericElement> {
	const { tree, omit } = params
	if (!omit?.length) return tree

	const compiledOmit = parseOmit(omit)

	const filterNode = (
		node: TreeRecord<GenericConfig, ElementsOf<GenericConfig>>,
	): TreeRecord<GenericConfig, ElementsOf<GenericConfig>> => {
		if (shouldStopTraversal({ record: node, compiledOmit })) {
			return { ...node, tree: [] }
		}

		const tree = node.tree
			.filter((child) => !isOmitted({ record: child, compiledOmit }))
			.map((child) => filterNode(child))

		return { ...node, tree }
	}

	return filterNode(tree) as TreeRecord<GenericConfig, GenericElement>
}
