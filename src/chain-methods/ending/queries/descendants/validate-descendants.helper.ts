import { getRecord, matchesAttributeFilter } from '@/helpers'

import { deduplicateByTag, mapToResult } from './group-records.helper'

import type { PathLevel, ValidationResult, CollectedTags } from './types'
import type { DatabaseInstance } from '@/index'
import type { AnyDialecteConfig, Context, ChainRecord, ElementsOf } from '@/types'

/**
 * Validate all candidates and collect ancestor tags
 * Returns grouped, deduplicated result
 */
export async function validateDescendants<
	GenericConfig extends AnyDialecteConfig,
	GenericElement extends ElementsOf<GenericConfig>,
>(params: {
	context: Context<GenericConfig, ElementsOf<GenericConfig>>
	dialecteConfig: GenericConfig
	databaseInstance: DatabaseInstance<GenericConfig>
	candidates: ChainRecord<GenericConfig, GenericElement>[]
	focus: ChainRecord<GenericConfig, ElementsOf<GenericConfig>>
	path?: PathLevel<GenericConfig, ElementsOf<GenericConfig>>[]
	collectTags: Set<string>
}): Promise<Record<string, ChainRecord<GenericConfig, ElementsOf<GenericConfig>>[]>> {
	const { context, dialecteConfig, databaseInstance, candidates, focus, path, collectTags } = params

	const collected = new Map<string, ChainRecord<GenericConfig, ElementsOf<GenericConfig>>[]>()

	for (const candidate of candidates) {
		const result = await validate({
			candidate,
			focus,
			context,
			dialecteConfig,
			databaseInstance,
			path,
			shouldCollect: true,
		})

		if (!result.valid) continue

		if (result.ancestors) {
			collectFromAncestors(result.ancestors, collectTags, collected)
		}
	}

	// Deduplicate and convert to result object
	const deduplicated = deduplicateByTag(collected)
	return mapToResult(deduplicated, collectTags)
}

/**
 * Validate single candidate
 */
async function validate<
	GenericConfig extends AnyDialecteConfig,
	GenericElement extends ElementsOf<GenericConfig>,
>(params: {
	candidate: ChainRecord<GenericConfig, GenericElement>
	focus: ChainRecord<GenericConfig, ElementsOf<GenericConfig>>
	context: Context<GenericConfig, ElementsOf<GenericConfig>>
	dialecteConfig: GenericConfig
	databaseInstance: DatabaseInstance<GenericConfig>
	path?: PathLevel<GenericConfig, ElementsOf<GenericConfig>>[]
	shouldCollect: boolean
}): Promise<ValidationResult<GenericConfig>> {
	const { candidate, focus, context, dialecteConfig, databaseInstance, path, shouldCollect } =
		params

	if (candidate.id === focus.id) return { valid: false }

	if (path) {
		return validatePath({
			candidate,
			focus,
			context,
			dialecteConfig,
			databaseInstance,
			path,
			shouldCollect,
		})
	}

	return validateSimple({
		candidate,
		focus,
		context,
		dialecteConfig,
		databaseInstance,
		shouldCollect,
	})
}

/**
 * Simple validation - walk up until focus
 */
async function validateSimple<
	GenericConfig extends AnyDialecteConfig,
	GenericElement extends ElementsOf<GenericConfig>,
>(params: {
	candidate: ChainRecord<GenericConfig, GenericElement>
	focus: ChainRecord<GenericConfig, ElementsOf<GenericConfig>>
	context: Context<GenericConfig, ElementsOf<GenericConfig>>
	dialecteConfig: GenericConfig
	databaseInstance: DatabaseInstance<GenericConfig>
	shouldCollect: boolean
}): Promise<ValidationResult<GenericConfig>> {
	const { candidate, focus, context, dialecteConfig, databaseInstance, shouldCollect } = params

	let current = candidate.parent

	while (current) {
		if (current.id === focus.id && current.tagName === focus.tagName) {
			if (!shouldCollect) return { valid: true }

			const ancestors = await collectChain({
				from: candidate,
				toFocus: focus,
				context,
				dialecteConfig,
				databaseInstance,
			})
			return { valid: true, ancestors }
		}

		const record = await getRecord({
			id: current.id,
			tagName: current.tagName,
			stagedOperations: context.stagedOperations,
			dialecteConfig,
			databaseInstance,
			type: 'raw',
		})

		if (!record) return { valid: false }
		current = record.parent
	}

	return { valid: false }
}

/**
 * Path validation - match expected levels
 */
async function validatePath<
	GenericConfig extends AnyDialecteConfig,
	GenericElement extends ElementsOf<GenericConfig>,
>(params: {
	candidate: ChainRecord<GenericConfig, GenericElement>
	focus: ChainRecord<GenericConfig, ElementsOf<GenericConfig>>
	context: Context<GenericConfig, ElementsOf<GenericConfig>>
	dialecteConfig: GenericConfig
	databaseInstance: DatabaseInstance<GenericConfig>
	path: PathLevel<GenericConfig, ElementsOf<GenericConfig>>[]
	shouldCollect: boolean
}): Promise<ValidationResult<GenericConfig>> {
	const { candidate, focus, context, dialecteConfig, databaseInstance, path, shouldCollect } =
		params

	const ancestors: ChainRecord<GenericConfig, ElementsOf<GenericConfig>>[] = shouldCollect
		? [candidate]
		: []
	let current = candidate.parent

	// Walk path in reverse
	for (let i = path.length - 1; i >= 0; i--) {
		const expected = path[i]

		const match = await findMatchingLevel({
			current,
			expected,
			context,
			dialecteConfig,
			databaseInstance,
		})

		if (!match.found) return { valid: false }

		if (match.record && shouldCollect) {
			ancestors.push(match.record)
		}

		current = match.next ?? null
	}

	// After path, should reach focus
	const valid = current?.id === focus.id && current?.tagName === focus.tagName

	return { valid, ancestors: shouldCollect ? ancestors : undefined }
}

/**
 * Find level matching expected (allows skipping)
 */
async function findMatchingLevel<GenericConfig extends AnyDialecteConfig>(params: {
	current: { tagName: string; id: string } | null
	expected: PathLevel<GenericConfig, ElementsOf<GenericConfig>>
	context: Context<GenericConfig, ElementsOf<GenericConfig>>
	dialecteConfig: GenericConfig
	databaseInstance: DatabaseInstance<GenericConfig>
}): Promise<{
	found: boolean
	record?: ChainRecord<GenericConfig, ElementsOf<GenericConfig>>
	next?: { tagName: string; id: string } | null
}> {
	const { current, expected, context, dialecteConfig, databaseInstance } = params

	let cursor = current

	while (cursor) {
		if (cursor.tagName !== expected.tagName) {
			const record = await getRecord({
				id: cursor.id,
				tagName: cursor.tagName as ElementsOf<GenericConfig>,
				stagedOperations: context.stagedOperations,
				dialecteConfig,
				databaseInstance,
				type: 'raw',
			})
			cursor = record?.parent ?? null
			continue
		}

		// Tag matches - validate attributes if needed
		const needsValidation = expected.attributes !== undefined

		if (needsValidation) {
			const record = await getRecord({
				id: cursor.id,
				tagName: cursor.tagName as ElementsOf<GenericConfig>,
				stagedOperations: context.stagedOperations,
				dialecteConfig,
				databaseInstance,
				type: 'chain',
			})

			if (!record) return { found: false }

			if (!matchesAttributeFilter(record, expected.attributes!)) {
				return { found: false }
			}

			return { found: true, record, next: record.parent }
		}

		// No validation needed - fetch chain record for collection
		const record = await getRecord({
			id: cursor.id,
			tagName: cursor.tagName as ElementsOf<GenericConfig>,
			stagedOperations: context.stagedOperations,
			dialecteConfig,
			databaseInstance,
			type: 'chain',
		})

		if (!record) return { found: false }

		return { found: true, record, next: record.parent }
	}

	return { found: false }
}

/**
 * Collect full ancestor chain for tag collection
 */
async function collectChain<
	GenericConfig extends AnyDialecteConfig,
	GenericElement extends ElementsOf<GenericConfig>,
>(params: {
	from: ChainRecord<GenericConfig, GenericElement>
	toFocus: ChainRecord<GenericConfig, ElementsOf<GenericConfig>>
	context: Context<GenericConfig, ElementsOf<GenericConfig>>
	dialecteConfig: GenericConfig
	databaseInstance: DatabaseInstance<GenericConfig>
}): Promise<ChainRecord<GenericConfig, ElementsOf<GenericConfig>>[]> {
	const { from, toFocus, context, dialecteConfig, databaseInstance } = params

	const chain: ChainRecord<GenericConfig, ElementsOf<GenericConfig>>[] = [from]
	let current = from.parent

	while (current && !(current.id === toFocus.id && current.tagName === toFocus.tagName)) {
		const record = await getRecord({
			id: current.id,
			tagName: current.tagName as ElementsOf<GenericConfig>,
			stagedOperations: context.stagedOperations,
			dialecteConfig,
			databaseInstance,
			type: 'chain',
		})

		if (record) {
			chain.push(record)
			current = record.parent
		} else {
			break
		}
	}

	return chain
}

/**
 * Collect tags from ancestors
 */
function collectFromAncestors<GenericConfig extends AnyDialecteConfig>(
	ancestors: ChainRecord<GenericConfig, ElementsOf<GenericConfig>>[],
	tags: Set<string>,
	collected: CollectedTags<GenericConfig>,
): void {
	for (const ancestor of ancestors) {
		if (!tags.has(ancestor.tagName)) continue

		if (!collected.has(ancestor.tagName)) {
			collected.set(ancestor.tagName, [])
		}
		collected.get(ancestor.tagName)!.push(ancestor)
	}
}
