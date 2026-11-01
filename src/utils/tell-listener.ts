/**
 * Tell a listener, never waiting for it: a listener on the far side of a closed port may never answer, and its
 * failure is not the caller's - reported on the console with what it was told of (`of`), the caller going on.
 */
export function tellListener<GenericValue>(params: {
	listener: ((value: GenericValue) => unknown) | undefined
	value: GenericValue
	/** What the listener is told of, as the report names it ("an import's progress"). */
	of: string
}): void {
	const { listener, value, of } = params
	if (!listener) return
	try {
		const answer: unknown = listener(value)
		// a promise of another realm, or any thenable, is not `instanceof Promise` here
		if (isThenable(answer)) {
			Promise.resolve(answer).catch(function reportRejection(thrown: unknown) {
				reportListenerFailure({ of, thrown })
			})
		}
	} catch (thrown) {
		reportListenerFailure({ of, thrown })
	}
}

/** What a store's subscribers are told of, as the report of a failure names it. */
export function changesOfProject(params: { name: string }): string {
	return `the changes of project "${params.name}"`
}

/** Tell each listener `value`, as the set stood when told: one that fails stops no other. */
export function tellListeners<GenericValue>(params: {
	listeners: Iterable<(value: GenericValue) => unknown>
	value: GenericValue
	of: string
}): void {
	const { listeners, value, of } = params
	for (const listener of Array.from(listeners)) tellListener({ listener, value, of })
}

function reportListenerFailure(params: { of: string; thrown: unknown }): void {
	console.error(`[dialecte] a listener of ${params.of} threw; what told it goes on:`, params.thrown)
}

function isThenable(value: unknown): value is PromiseLike<unknown> {
	return (
		typeof value === 'object' &&
		value !== null &&
		typeof (value as { then?: unknown }).then === 'function'
	)
}
