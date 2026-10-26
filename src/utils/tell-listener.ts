/**
 * Tell a listener, never waiting for it: a listener on the far side of a closed port may never answer, and its
 * failure is not the caller's.
 */
export function tellListener<GenericValue>(params: {
	listener: ((value: GenericValue) => unknown) | undefined
	value: GenericValue
}): void {
	const { listener, value } = params
	if (!listener) return
	try {
		const answer: unknown = listener(value)
		// a promise of another realm, or any thenable, is not `instanceof Promise` here
		if (isThenable(answer)) Promise.resolve(answer).catch(ignoreListenerFailure)
	} catch {
		// a listener that throws is the listener's problem, not the caller's
	}
}

function ignoreListenerFailure(): void {}

function isThenable(value: unknown): value is PromiseLike<unknown> {
	return (
		typeof value === 'object' &&
		value !== null &&
		typeof (value as { then?: unknown }).then === 'function'
	)
}
