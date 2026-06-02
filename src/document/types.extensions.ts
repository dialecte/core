//== Extension function signatures ================================

/**
 * A query extension: a function whose first argument is the Query instance.
 * The remaining arguments become the public signature after binding.
 *
 * The first arg defaults to `any` because of TypeScript parameter
 * contravariance: extension authors typically write
 * `(q: **.Query, ...) => ...` where `**.Query` is narrower than
 * `Query<Config>`. A function requiring a narrower param cannot be
 * assigned to one requiring a wider one, so the registration slot must
 * stay wide. Authors annotate the concrete query type themselves; type
 * safety at the call boundary is recovered via `BoundExtensionMap`.
 */
// oxlint-disable-next-line - any required for variance
export type QueryExtensionFn<GenericQuery = any> = (query: GenericQuery, ...args: any[]) => any

/**
 * A transaction extension: a function whose first argument is the Transaction instance.
 * Same variance considerations as `QueryExtensionFn`.
 */
// oxlint-disable-next-line - any required for variance
export type TransactionExtensionFn<GenericTransaction = any> = (
	tx: GenericTransaction,
	...args: any[]
) => any

//== Extension groups =============================================

/** A group of extension functions keyed by method name. */
export type ExtensionGroup<Fn> = Record<string, Fn>

/** A map of PascalCase group names → extension groups. */
export type ExtensionMap<Fn> = Record<string, ExtensionGroup<Fn>>

//== Extension module (per-element shape) =========================

/**
 * A single named extension module, grouping its query and transaction methods.
 * Use this as the shape for each element's extension file (e.g. History/index.ts).
 */
export type ExtensionModule = {
	query?: ExtensionGroup<QueryExtensionFn>
	transaction?: ExtensionGroup<TransactionExtensionFn>
}

//== Extensions config ============================================

/**
 * Extensions configuration for a dialecte.
 * A record of named extension modules (e.g. { History: { query: ... } }).
 * Produced by mergeExtensions().
 */
export type ExtensionsRegistry = {
	query?: Record<string, NonNullable<ExtensionModule['query']>>
	transaction?: Record<string, NonNullable<ExtensionModule['transaction']>>
}

//== Collision guard ==============================================

/**
 * Compile-time guard: rejects any extension group name that collides
 * with a core method on Query or Transaction.
 */
export type AssertNoCollision<
	Extensions extends Record<string, unknown>,
	Reserved extends string,
> = {
	[K in keyof Extensions]: K extends Reserved
		? `Extension group "${K & string}" collides with a core method`
		: Extensions[K]
}

//== Bound extensions (strips first arg from each function) ======

/** Strips the first argument from a function signature. */
// oxlint-disable-next-line - any required for variance
export type OmitFirstArg<GenericFn extends (...args: any[]) => any> = GenericFn extends (
	first: any,
	...rest: infer Rest
) => infer Return
	? (...args: Rest) => Return
	: never

/**
 * Given a map of extension groups, produces the same structure
 * but with the first argument (query/tx) stripped from each function.
 */
export type BoundExtensionMap<
	GenericExtensionsMap extends ExtensionMap<QueryExtensionFn | TransactionExtensionFn>,
> = {
	[GroupName in keyof GenericExtensionsMap]: {
		[MethodName in keyof GenericExtensionsMap[GroupName]]: OmitFirstArg<
			GenericExtensionsMap[GroupName][MethodName]
		>
	}
}

//== Extension accessor type ======================================

export type QueryExtensions<Ext extends ExtensionsRegistry> = Ext extends {
	query: infer Q extends ExtensionMap<QueryExtensionFn>
}
	? BoundExtensionMap<Q>
	: {}

export type AllExtensions<Ext extends ExtensionsRegistry> = QueryExtensions<Ext> &
	(Ext extends { transaction: infer M extends ExtensionMap<TransactionExtensionFn> }
		? BoundExtensionMap<M>
		: {})

/**
 * A record of named extension modules (keys are element names, e.g. 'History').
 */
export type ExtensionModules = Record<string, ExtensionModule>

/**
 * Derives the merged ExtensionsRegistry type from a record of ExtensionModules.
 * mergeExtensions({ History }) → { query: { History: ... }, transaction: {} }
 * Modules without query/transaction are filtered out.
 */
export type MergedExtensions<Modules extends ExtensionModules> = {
	query: {
		[K in keyof Modules as Modules[K]['query'] extends ExtensionGroup<QueryExtensionFn>
			? K
			: never]: Modules[K]['query'] extends ExtensionGroup<QueryExtensionFn>
			? Modules[K]['query']
			: never
	}
	transaction: {
		[K in keyof Modules as Modules[K]['transaction'] extends ExtensionGroup<TransactionExtensionFn>
			? K
			: never]: Modules[K]['transaction'] extends ExtensionGroup<TransactionExtensionFn>
			? Modules[K]['transaction']
			: never
	}
}
