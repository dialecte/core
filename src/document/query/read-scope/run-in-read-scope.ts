import { READ_SCOPE_KEY, READ_SCOPE_WIRING_KEY } from './read-scope.constants'

import type { ReadScope, ReadScopeWiring } from './read-scope.types'

/**
 * Wire `query` so that each public verb called on it opens a read scope: the Document's read epoch and the binding of
 * its query extensions. A Query no Document wired (a Transaction among them) never opens one.
 *
 * @internal called by the Document on each Query it builds
 */
export function attachReadScopeWiring(params: { query: object; wiring: ReadScopeWiring }): void {
	carry({ target: params.query, key: READ_SCOPE_WIRING_KEY, value: params.wiring })
}

/**
 * The open scope `instance` runs in, `undefined` when it runs in none or its call settled.
 *
 * @internal read by `Query.context`
 */
export function openReadScopeOf(instance: object): ReadScope | undefined {
	const scope = Reflect.get(instance, READ_SCOPE_KEY) as ReadScope | undefined
	return scope && !scope.closed ? scope : undefined
}

/**
 * Run a public verb's `call` in a read scope. On a wired query with no open scope, `call` runs on a scoped child of it
 * (`Object.create(instance)`, the query extensions bound to the child) whose new scope every call nested in it shares,
 * closed when `call` settles; elsewhere (already in a scope, or never wired) `call` runs on `instance` itself. No
 * AsyncLocalStorage and no module-level registry: the scope travels on the object the call runs on (under a symbol
 * key, the wiring inherited from the query), so two unrelated calls on one query, even concurrent, get two children
 * and two scopes, and no two queries ever share one.
 *
 * @internal shared by the scoped methods of `Query` and the bound query extensions
 */
export function runInReadScope<GenericResult>(params: {
	instance: object
	call: (target: object) => GenericResult
}): GenericResult {
	const { instance, call } = params
	const wiring = Reflect.get(instance, READ_SCOPE_WIRING_KEY) as ReadScopeWiring | undefined
	if (!wiring || openReadScopeOf(instance)) return call(instance)

	const child = Object.create(instance) as object
	const scope = openScope({ wiring })
	carry({ target: child, key: READ_SCOPE_KEY, value: scope })
	Object.assign(child, wiring.bindQueryExtensions(child))

	let result: GenericResult
	try {
		result = call(child)
	} catch (thrown) {
		scope.closed = true
		throw thrown
	}
	if (!isThenable(result)) {
		scope.closed = true
		return result
	}
	return result.then(
		function closeOnAnswer(value) {
			scope.closed = true
			return value
		},
		function closeOnFailure(thrown: unknown) {
			scope.closed = true
			throw thrown
		},
	) as GenericResult
}

/**
 * Wrap each named method of `prototype` so it runs in a read scope (`runInReadScope`).
 *
 * @internal applied once to `Query.prototype`
 */
export function scopeReadMethods(params: { prototype: object; names: readonly string[] }): void {
	const { prototype, names } = params
	for (const name of names) {
		const method = Reflect.get(prototype, name) as (...args: unknown[]) => unknown
		Reflect.set(prototype, name, function scopedMethod(this: object, ...args: unknown[]) {
			return runInReadScope({
				instance: this,
				call: (target) => method.apply(target, args),
			})
		})
	}
}

function openScope(params: { wiring: ReadScopeWiring }): ReadScope {
	const { wiring } = params
	return {
		documentId: wiring.documentId,
		epoch: wiring.epochOf(),
		version: undefined,
		records: new Map(),
		tagAnswers: new Map(),
		attributeAnswers: new Map(),
		documentAnswer: undefined,
		closed: false,
		epochOf: wiring.epochOf,
	}
}

function isThenable(value: unknown): value is PromiseLike<unknown> {
	return (
		typeof value === 'object' &&
		value !== null &&
		typeof (value as { then?: unknown }).then === 'function'
	)
}

/** `value` held on `target` under `key`: not enumerable, so no spread, `Object.assign` or JSON of a query sees it. */
function carry(params: { target: object; key: symbol; value: unknown }): void {
	Object.defineProperty(params.target, params.key, {
		value: params.value,
		enumerable: false,
		writable: true,
		configurable: true,
	})
}
