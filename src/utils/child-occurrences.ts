import { UNCONSTRAINED } from './child-occurrences.constants'

import type { ChildOccurrences } from './child-occurrences.types'
import type { ContentDefinition, Particle } from '@/types'

export type { ChildOccurrences } from './child-occurrences.types'

/**
 * How often each child may appear under an element, read from its resolved definition (`resolveDefinition`,
 * or `query.getDefinition`): per child in `children.sequence` order, `{ min, max }` with `max` undefined for
 * unbounded. An absent `minOccurs` is 0 and an absent `maxOccurs` unbounded, as the generator writes them; a
 * sequence adds what its particles allow, a choice keeps the widest of its branches (0 when a branch lacks the
 * child), a group's own occurrences multiply what it holds. A child the content model does not name (no model,
 * or one only a variant holds) is optional and unbounded.
 *
 * @intent how many times a child may appear, required or optional children of an element, cardinality of children
 */
export function childOccurrences(params: {
	definition: Pick<ContentDefinition, 'children' | 'contentModel'>
}): Readonly<Record<string, ChildOccurrences>> {
	const { children, contentModel } = params.definition
	const named = contentModel ? occurrencesOf(contentModel) : new Map<string, ChildOccurrences>()
	return Object.fromEntries(
		children.sequence.map((tagName) => [tagName, named.get(tagName) ?? UNCONSTRAINED]),
	)
}

function occurrencesOf(particle: Particle): Map<string, ChildOccurrences> {
	const own = { min: particle.minOccurs ?? 0, max: particle.maxOccurs }
	if (particle.kind === 'element') return new Map([[particle.name, own]])
	if (particle.kind === 'any') return new Map()
	const branches = particle.particles.map(occurrencesOf)
	const held = particle.kind === 'choice' ? widest(branches) : summed(branches)
	return new Map(
		[...held].map(([tagName, occurrences]) => [
			tagName,
			{
				min: occurrences.min * own.min,
				max:
					occurrences.max === undefined || own.max === undefined
						? undefined
						: occurrences.max * own.max,
			},
		]),
	)
}

function summed(branches: readonly Map<string, ChildOccurrences>[]): Map<string, ChildOccurrences> {
	const total = new Map<string, ChildOccurrences>()
	for (const branch of branches)
		for (const [tagName, occurrences] of branch) {
			const previous = total.get(tagName)
			total.set(
				tagName,
				previous === undefined
					? occurrences
					: {
							min: previous.min + occurrences.min,
							max:
								previous.max === undefined || occurrences.max === undefined
									? undefined
									: previous.max + occurrences.max,
						},
			)
		}
	return total
}

function widest(branches: readonly Map<string, ChildOccurrences>[]): Map<string, ChildOccurrences> {
	const tagNames = new Set(branches.flatMap((branch) => [...branch.keys()]))
	return new Map(
		[...tagNames].map((tagName) => {
			const perBranch = branches.map((branch) => branch.get(tagName) ?? { min: 0, max: 0 })
			const unbounded = perBranch.some((occurrences) => occurrences.max === undefined)
			return [
				tagName,
				{
					min: Math.min(...perBranch.map((occurrences) => occurrences.min)),
					max: unbounded
						? undefined
						: Math.max(...perBranch.map((occurrences) => occurrences.max ?? 0)),
				},
			]
		}),
	)
}
