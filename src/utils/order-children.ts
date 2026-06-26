/**
 * Order a parent's child nodes by the config-declared child sequence.
 *
 * Generic over node type (anything with a `tagName`) so the same logic serves
 * both record-level XML building and TreeRecord post-processing — a single
 * source of truth for "config order". Children whose tagName is not in the
 * sequence are appended last, preserving their relative order. When the parent
 * has no declared sequence, the input order is returned unchanged.
 *
 * Pure function — no side effects.
 */
export function orderByConfigSequence<GenericNode extends { tagName: string }>(params: {
	parentTagName: string
	children: GenericNode[]
	childrenConfig: Record<string, readonly string[]>
}): GenericNode[] {
	const { parentTagName, children, childrenConfig } = params

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

	const ordered: GenericNode[] = []
	for (const tagName of order) {
		const bucket = byTagName.get(tagName)
		if (bucket && bucket.length) ordered.push(...bucket)
	}
	ordered.push(...unknowns)
	return ordered
}
