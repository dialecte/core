/** A string in the layout of a UUID: what `crypto.randomUUID` answers. */
export type UuidShaped = `${string}-${string}-${string}-${string}-${string}`

/** What `createSeededRandomUuid` is given: the seed the whole sequence follows from. */
export type CreateSeededRandomUuidParams = {
	/** Any integer: the same seed gives the same sequence of ids. */
	seed: number
}
