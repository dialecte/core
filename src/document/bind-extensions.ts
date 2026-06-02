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
 * Returns a frozen object of { GroupName: { methodName: boundFn } }.
 */
export function bindExtensions<
	GenericExtensionsMap extends ExtensionMap<QueryExtensionFn | TransactionExtensionFn>,
>(
	extensionMap: GenericExtensionsMap | undefined,
	instance: unknown,
): BoundExtensionMap<GenericExtensionsMap> {
	if (!extensionMap) return {} as BoundExtensionMap<GenericExtensionsMap>

	const bound: Record<string, Record<string, (...args: unknown[]) => unknown>> = {}

	for (const groupName of Object.keys(extensionMap)) {
		const group = extensionMap[groupName]
		const boundGroup: Record<string, (...args: unknown[]) => unknown> = {}
		for (const methodName of Object.keys(group)) {
			const fn = group[methodName]
			boundGroup[methodName] = (...args: unknown[]) => fn(instance as never, ...args)
		}
		bound[groupName] = boundGroup
	}

	return bound as BoundExtensionMap<GenericExtensionsMap>
}
