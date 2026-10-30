/**
 * How often a particle of a content model holds each element: a sequence adds what its particles allow, a choice
 * keeps the widest of its branches (0 when a branch lacks the element), a group's own occurrences multiply what it
 * holds. Shared by the content-model readers; not exported from the package.
 */
import type { ChildOccurrences } from './child-occurrences.types'
import type { Particle } from '@/types'

export function occurrencesOf(particle: Particle): Map<string, ChildOccurrences> {
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
