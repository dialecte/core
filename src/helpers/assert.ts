export function assert(condition: unknown, message?: string): asserts condition {
	if (condition) return
	const prefix = 'Assertion failed'
	const errorMessage = message ? `${prefix}: ${message}` : prefix
	throw new Error(errorMessage)
}
