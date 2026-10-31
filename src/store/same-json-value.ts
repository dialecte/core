/**
 * Whether two JSON values hold the same (objects compared by their keys whatever their order, arrays in order): an
 * update that writes back what a document holds changes nothing.
 */
export function sameJsonValue(params: { first: unknown; second: unknown }): boolean {
	return canonicalJson({ value: params.first }) === canonicalJson({ value: params.second })
}

/** A JSON value written with every object's keys in order: one text for every way of writing the same value. */
function canonicalJson(params: { value: unknown }): string {
	return JSON.stringify(params.value, function sortedKeys(_key, value: unknown) {
		if (value === null || typeof value !== 'object' || Array.isArray(value)) return value
		return Object.fromEntries(
			Object.entries(value).sort(function byKey([first], [second]) {
				return first < second ? -1 : first > second ? 1 : 0
			}),
		)
	})
}
