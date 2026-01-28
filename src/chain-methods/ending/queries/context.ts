import type { AnyDialecteConfig, ElementsOf } from '@/types'
import type { Context } from '@/types/context'

/**
 * Get the internal chain context
 *
 * @param contextPromise - Current chain context
 * @returns Async function to get context (ending method)
 */
export function createGetContextMethod<
	GenericConfig extends AnyDialecteConfig,
	GenericElement extends ElementsOf<GenericConfig>,
>(params: { contextPromise: Promise<Context<GenericConfig, GenericElement>> }) {
	const { contextPromise } = params
	return async function (): Promise<Context<GenericConfig, GenericElement>> {
		const context = await contextPromise
		return structuredClone(context)
	}
}
