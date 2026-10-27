import { isNamespaceAllowedByWildcard } from './namespaces'

import type { WildcardSlot } from './order-children.types'
import type { AnyDefinition, Particle } from '@/types'

/**
 * Order a parent's child nodes by the config-declared child sequence.
 *
 * Generic over node type (anything with a `tagName`) so the same logic serves
 * both record-level XML building and TreeRecord post-processing — a single
 * source of truth for "config order". With the dialecte's `definition`, a child
 * outside the sequence whose tag the definition declares, and that a wildcard of
 * the parent's content model admits (by its declared tag's namespace: a node
 * carries no namespace), takes that wildcard's slot: the first admitting
 * wildcard with room left (its maxOccurs, times those of the groups holding it).
 * The other children outside the sequence are appended last, preserving their
 * relative order. The parent's content model is its tag level's; a wildcard
 * before a child declared again further on (`A, any, A`) sits after that child's
 * group, as a declared tag has one place. When the parent has no declared
 * sequence, the input order is returned unchanged.
 *
 * Pure function — no side effects.
 */
export function orderByConfigSequence<GenericNode extends { tagName: string }>(params: {
	parentTagName: string
	children: GenericNode[]
	childrenConfig: Record<string, readonly string[]>
	definition?: AnyDefinition
}): GenericNode[] {
	const { parentTagName, children, childrenConfig, definition } = params

	const sequence = childrenConfig[parentTagName]
	if (!sequence || sequence.length === 0) return children

	const order = new Set<string>(sequence)
	const byTagName = new Map<string, GenericNode[]>()
	for (const tagName of order) byTagName.set(tagName, [])

	const unknowns: GenericNode[] = []
	for (const child of children) {
		const bucket = byTagName.get(child.tagName)
		if (bucket) bucket.push(child)
		else unknowns.push(child)
	}

	const parentDefinition = definition?.[parentTagName]
	const slots =
		definition && unknowns.length > 0 && parentDefinition?.children.any === true
			? wildcardSlotsOf({ contentModel: parentDefinition.contentModel, order })
			: []
	const admitted = slots.map((): GenericNode[] => [])
	const unmatched: GenericNode[] = slots.length > 0 ? [] : unknowns
	if (definition && slots.length > 0) {
		for (const child of unknowns) {
			const index = admittingSlotOf({ slots, admitted, definition, tagName: child.tagName })
			if (index === -1) unmatched.push(child)
			else admitted[index].push(child)
		}
	}

	const ordered: GenericNode[] = []
	for (const tagName of order) {
		if (slots.length > 0) pushAdmittedBefore({ ordered, slots, admitted, before: tagName })
		const bucket = byTagName.get(tagName)
		if (bucket && bucket.length) ordered.push(...bucket)
	}
	if (slots.length > 0) pushAdmittedBefore({ ordered, slots, admitted, before: undefined })
	ordered.push(...unmatched)
	return ordered
}

/**
 * The wildcards of a content model in document order, each with the next declared child after it that the model
 * does not hold before it, and its capacity.
 */
function wildcardSlotsOf(params: {
	contentModel: Particle | undefined
	order: ReadonlySet<string>
}): WildcardSlot[] {
	const { contentModel, order } = params
	const slots: WildcardSlot[] = []
	const seen = new Set<string>()
	let pending: Omit<WildcardSlot, 'before'>[] = []

	function walk(particle: Particle, groupCapacity: number): void {
		const capacity = groupCapacity * (particle.maxOccurs ?? Number.POSITIVE_INFINITY)
		if (particle.kind === 'any') {
			pending.push({ wildcard: particle, capacity })
			return
		}
		if (particle.kind === 'element') {
			if (!order.has(particle.name) || seen.has(particle.name)) return
			seen.add(particle.name)
			for (const slot of pending) slots.push({ ...slot, before: particle.name })
			pending = []
			return
		}
		for (const inner of particle.particles) walk(inner, capacity)
	}

	if (contentModel) walk(contentModel, 1)
	for (const slot of pending) slots.push({ ...slot, before: undefined })
	return slots
}

/** The first slot admitting the tag's declared namespace with room left, `-1` for none (or an undeclared tag). */
function admittingSlotOf(params: {
	slots: readonly WildcardSlot[]
	admitted: readonly unknown[][]
	definition: AnyDefinition
	tagName: string
}): number {
	const { slots, admitted, definition, tagName } = params
	const namespaceUri = definition[tagName]?.namespace.uri
	if (namespaceUri === undefined) return -1
	return slots.findIndex(
		(slot, index) =>
			admitted[index].length < slot.capacity &&
			isNamespaceAllowedByWildcard({ wildcard: slot.wildcard, namespaceUri }),
	)
}

/** Append, in slot order, the children admitted by the wildcards sitting before `before`. */
function pushAdmittedBefore<GenericNode>(params: {
	ordered: GenericNode[]
	slots: readonly WildcardSlot[]
	admitted: readonly GenericNode[][]
	before: string | undefined
}): void {
	const { ordered, slots, admitted, before } = params
	slots.forEach((slot, index) => {
		if (slot.before === before) ordered.push(...admitted[index])
	})
}
