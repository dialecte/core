import type {
	BoundExtensionMap,
	ExtensionMap,
	QueryExtensionFn,
	TransactionExtensionFn,
} from './types.extensions'

/**
 * Binds an extension map to an instance (Query or Transaction).
 * Each function in the map gets `instance` prepended as its first argument,
 * so the public API signature has that argument stripped.
 *
 * Groups may be nested to arbitrary depth: a value is either an extension
 * function (a leaf, bound to the instance) or a nested group (recursed into).
 * So `{ a: { aa: { getItems } } }` yields `instance.a.aa.getItems`.
 *
 * Returns an object mirroring the map's shape with each function bound.
 */
export function bindExtensions<
	GenericExtensionsMap extends ExtensionMap<QueryExtensionFn | TransactionExtensionFn>,
>(
	extensionMap: GenericExtensionsMap | undefined,
	instance: unknown,
): BoundExtensionMap<GenericExtensionsMap> {
	if (!extensionMap) return {} as BoundExtensionMap<GenericExtensionsMap>

	return bindGroup(extensionMap, instance) as BoundExtensionMap<GenericExtensionsMap>
}

type UnknownGroup = { [key: string]: ((...args: unknown[]) => unknown) | UnknownGroup }

function bindGroup(group: Record<string, unknown>, instance: unknown): UnknownGroup {
	const bound: UnknownGroup = {}

	for (const key of Object.keys(group)) {
		const value = group[key]
		bound[key] =
			typeof value === 'function'
				? (...args: unknown[]) => (value as (...a: unknown[]) => unknown)(instance, ...args)
				: bindGroup(value as Record<string, unknown>, instance)
	}

	return bound
}
