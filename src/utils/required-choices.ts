import { occurrencesOf } from './particle-occurrences'

import type { ChoiceBranch, RequiredChoice } from './required-choices.types'
import type { ContentDefinition, Particle } from '@/types'

export type { ChoiceBranch, RequiredChoice } from './required-choices.types'

/**
 * The choices an element's content model requires (`resolveDefinition`, or `query.getDefinition`): each one
 * reached through groups that are all required, with how many times it is taken (the groups' own minimum
 * occurrences multiplied) and its branches in order - per branch, how often it holds each child (as
 * `childOccurrences` counts them) and the choices it requires in turn. `childOccurrences` reads a child of a
 * choice of several branches as optional; this is where a valid instance learns it must take one branch. An
 * optional choice, or one inside an optional group, is not listed.
 *
 * @intent which children an element must hold where its content model offers a choice, the branches of a required choice, build a valid element from its content model
 */
export function requiredChoices(params: {
	definition: Pick<ContentDefinition, 'contentModel'>
}): readonly RequiredChoice[] {
	const { contentModel } = params.definition
	return contentModel ? choicesIn({ particle: contentModel, times: 1 }) : []
}

function choicesIn(params: { particle: Particle; times: number }): RequiredChoice[] {
	const { particle } = params
	if (particle.kind === 'element' || particle.kind === 'any') return []
	const times = params.times * (particle.minOccurs ?? 0)
	if (times === 0) return []
	if (particle.kind === 'choice')
		return [{ min: times, branches: particle.particles.map(branchOf) }]
	return particle.particles.flatMap((child) => choicesIn({ particle: child, times }))
}

function branchOf(particle: Particle): ChoiceBranch {
	return {
		children: Object.fromEntries(occurrencesOf(particle)),
		choices: choicesIn({ particle, times: 1 }),
	}
}
