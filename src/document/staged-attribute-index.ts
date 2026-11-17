import type { StagedOperations } from './types'
import type { AttributeLookup } from '@/store'
import type { AnyDialecteConfig } from '@/types'

/**
 * The ids whose last staged operation leaves a record of the tag holding, for every entry, an attribute of its name
 * with one of its values: read from the staged attribute index, never from the log. Unordered; a superset the caller
 * re-checks with its filter.
 *
 * @internal the staged half of an attribute lookup
 */
export function stagedIdsMatching<GenericConfig extends AnyDialecteConfig>(params: {
	stagedOperations: StagedOperations<GenericConfig>
	tagName: string
	attributes: AttributeLookup['attributes']
}): Set<string> {
	const { stagedOperations, tagName, attributes } = params
	const byName = stagedOperations.byAttribute.get(tagName)
	if (!byName || attributes.length === 0) return new Set()
	const matched = attributes.map(function idsOfEntry({ name, values }) {
		const byValue = byName.get(name)
		return new Set(values.flatMap((value) => [...(byValue?.get(value) ?? [])]))
	})
	const [smallest, ...others] = [...matched].sort((left, right) => left.size - right.size)
	return new Set([...smallest!].filter((id) => others.every((ids) => ids.has(id))))
}
