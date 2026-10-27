import type { Wildcard } from '@/types'

/** A wildcard of a content model, where its children go and how many it takes. */
export type WildcardSlot = {
	wildcard: Wildcard
	/** The declared child it sits before (`undefined` = after them all). */
	before: string | undefined
	/** Its maxOccurs times those of the groups holding it (`Infinity` = unbounded). */
	capacity: number
}
