import type { ChildDefinition } from '@/types'

/** An edge that carries the element as declared under its parent: attributes and children, at least. */
export type DeclaredEdge = ChildDefinition &
	Required<Pick<ChildDefinition, 'attributes' | 'children'>>
