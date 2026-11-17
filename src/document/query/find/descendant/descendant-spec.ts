import { matchesAttributeFilter } from '@/document'

import type {
	CollectedGroups,
	CollectSpecification,
	FlatTarget,
	OmitSpec,
	PathNode,
} from './descendant-spec.types'
import type { Collect } from './find-descendant.types'
import type { OmitEntry } from '@/document'
import type { AnyDialecteConfig, ElementsOf, TrackedRecord } from '@/types'

// ============================================================================
// Omit specification
// ============================================================================

export function parseOmitEntries<GenericConfig extends AnyDialecteConfig>(params: {
	omit: OmitEntry<GenericConfig>[] | undefined
	dialecteConfig: GenericConfig
}): OmitSpec {
	const { omit, dialecteConfig } = params
	const unconditional = new Set<string>()
	const conditional: OmitSpec['conditional'] = []

	if (!omit) return { dialecteConfig, unconditional, conditional }

	for (const entry of omit) {
		if (typeof entry === 'string') {
			unconditional.add(entry)
		} else {
			const tagName = Object.keys(entry)[0]
			const config = (entry as Record<string, { where?: Record<string, unknown> }>)[tagName]
			if (!config?.where) {
				unconditional.add(tagName)
			} else {
				conditional.push({ tagName, where: config.where })
			}
		}
	}
	return { dialecteConfig, unconditional, conditional }
}

export function hasOmit(omitSpec: OmitSpec): boolean {
	return omitSpec.unconditional.size > 0 || omitSpec.conditional.length > 0
}

export function isOmitted<GenericConfig extends AnyDialecteConfig>(params: {
	record: TrackedRecord<GenericConfig, ElementsOf<GenericConfig>>
	omitSpec: OmitSpec
}): boolean {
	const { record, omitSpec } = params
	if (omitSpec.unconditional.has(record.tagName)) return true
	for (const cond of omitSpec.conditional) {
		if (cond.tagName !== record.tagName) continue
		if (
			matchesAttributeFilter({
				dialecteConfig: omitSpec.dialecteConfig as GenericConfig,
				record,
				attributeFilter: cond.where as Parameters<
					typeof matchesAttributeFilter<GenericConfig, ElementsOf<GenericConfig>>
				>[0]['attributeFilter'],
			})
		)
			return true
	}
	return false
}

// ============================================================================
// Collect specification
// ============================================================================

/**
 * Converts the user-facing `collect` value (string | array | object) into a
 * uniform `CollectSpecification` the traversal functions consume.
 *
 * String and array forms produce `mode: 'flat'`: under the document root the targets are read by tag name, under
 * any other scope the subtree is read top-down. Object form produces `mode: 'path'`: traversal follows the
 * declared nesting order.
 */
export function parseCollect<
	GenericConfig extends AnyDialecteConfig,
	GenericElement extends ElementsOf<GenericConfig>,
>(collect: Collect<GenericConfig, GenericElement>): CollectSpecification {
	// String form
	if (typeof collect === 'string') {
		return { mode: 'flat', targets: [{ tagName: collect }], allTags: new Set([collect]) }
	}

	// Array form
	if (Array.isArray(collect)) {
		const targets: FlatTarget[] = []
		const allTags = new Set<string>()
		for (const entry of collect) {
			if (typeof entry === 'string') {
				targets.push({ tagName: entry })
				allTags.add(entry)
			} else {
				for (const [tagName, config] of Object.entries(entry)) {
					targets.push({ tagName, where: (config as { where?: Record<string, unknown> })?.where })
					allTags.add(tagName)
				}
			}
		}
		return { mode: 'flat', targets, allTags }
	}

	// Object (path) form
	const entries = collect as Record<string, unknown>
	return {
		mode: 'path',
		paths: buildPathNodes({ entries }),
		allTags: new Set(pathTags({ entries })),
	}
}

function buildPathNodes(params: { entries: Record<string, unknown> }): PathNode[] {
	const nodes: PathNode[] = []
	for (const [tagName, value] of Object.entries(params.entries)) {
		if (tagName === 'where') continue
		const node = parsePathEntry({ tagName, value })
		if (node) nodes.push(node)
	}
	return nodes
}

function parsePathEntry(params: { tagName: string; value: unknown }): PathNode | undefined {
	const { tagName, value } = params

	if (value === true) {
		return { tagName, where: undefined, children: [], isLeaf: true }
	}

	if (typeof value !== 'object' || value === null) return undefined

	const nested = value as Record<string, unknown>
	const where = nested.where as Record<string, unknown> | undefined
	const childKeys = Object.keys(nested).filter((key) => key !== 'where')

	if (childKeys.length === 0) {
		return { tagName, where, children: [], isLeaf: true }
	}

	const entries = Object.fromEntries(childKeys.map((key) => [key, nested[key]]))
	return { tagName, where, children: buildPathNodes({ entries }), isLeaf: false }
}

/**
 * Every tag name a path collect names, at any level: each key but `where`, whether its entry parses into a level
 * or not (the answer holds a group for each).
 */
function pathTags(params: { entries: Record<string, unknown> }): string[] {
	return Object.entries(params.entries).flatMap(function tagsOfEntry([tagName, value]) {
		if (tagName === 'where') return []
		const nested =
			typeof value === 'object' && value !== null
				? pathTags({ entries: value as Record<string, unknown> })
				: []
		return [tagName, ...nested]
	})
}

export function matchesFlatTarget<GenericConfig extends AnyDialecteConfig>(params: {
	dialecteConfig: GenericConfig
	record: TrackedRecord<GenericConfig, ElementsOf<GenericConfig>>
	where: Record<string, unknown> | undefined
}): boolean {
	const { dialecteConfig, record, where } = params
	if (!where) return true
	return matchesAttributeFilter({
		dialecteConfig,
		record,
		attributeFilter: where as Parameters<
			typeof matchesAttributeFilter<GenericConfig, ElementsOf<GenericConfig>>
		>[0]['attributeFilter'],
	})
}

// ============================================================================
// Result
// ============================================================================

/** One empty group per collected tag name. */
export function emptyGroups<GenericConfig extends AnyDialecteConfig>(
	collectSpec: CollectSpecification,
): CollectedGroups<GenericConfig> {
	return new Map([...collectSpec.allTags].map((tagName) => [tagName, new Map()]))
}

export function buildResult<GenericConfig extends AnyDialecteConfig>(
	collected: CollectedGroups<GenericConfig>,
): Record<string, TrackedRecord<GenericConfig, ElementsOf<GenericConfig>>[]> {
	const result: Record<string, TrackedRecord<GenericConfig, ElementsOf<GenericConfig>>[]> = {}
	for (const [tagName, recordMap] of collected.entries()) {
		result[tagName] = Array.from(recordMap.values())
	}
	return result
}
