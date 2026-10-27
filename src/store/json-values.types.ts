/**
 * A value the JSON walk meets: the key or index holding it (`''` at the root), whether an array
 * holds it, and the objects and arrays it is held under (a cycle is one of them met again).
 */
export type JsonWalkStep = {
	value: unknown
	field: string | number
	inArray: boolean
	ancestors: object[]
}

/** What a value is to the walk once it is known to be JSON: kept as it is, or walked into. */
export type JsonKind = 'leaf' | 'array' | 'object'

/** `JSON` with its raw-JSON members, which the TypeScript library does not declare yet. */
export type JsonWithRawJson = typeof JSON & {
	rawJSON?: (text: string) => object
	isRawJSON?: (value: unknown) => boolean
}
