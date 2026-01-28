import type { Chain } from '@/chain-methods'
import type { DatabaseInstance } from '@/database'
import type { AnyDialecteConfig, ElementsOf, RootElementOf, SingletonElementsOf } from '@/types'

export type DialecteCore<GenericConfig extends AnyDialecteConfig> = {
	getState(): DialecteState
	getDatabaseInstance(): DatabaseInstance<GenericConfig>
	fromRoot(): Chain<GenericConfig, RootElementOf<GenericConfig>>
	fromElement<GenericElement extends ElementsOf<GenericConfig>>(
		params: FromElementParams<GenericConfig, GenericElement>,
	): Chain<GenericConfig, GenericElement>
}

export type DialecteState = {
	loading: boolean
	error: Error | null
	progress:
		| { phase: 'starting' }
		| { phase: 'executing'; operation: string }
		| { phase: 'ending'; current: number; total: number; operation: string }
		| null
}

export type FromElementParams<
	GenericConfig extends AnyDialecteConfig,
	GenericElement extends ElementsOf<GenericConfig>,
> =
	GenericElement extends SingletonElementsOf<GenericConfig>
		? { tagName: GenericElement; id?: string }
		: { tagName: GenericElement; id: string }
