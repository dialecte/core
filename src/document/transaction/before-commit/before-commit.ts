import { stageOperations } from '../stage-operations'

import type { Context, Query } from '@/document'
import type { AnyDialecteConfig, TransactionHooks } from '@/types'

/** Stage what the `beforeCommit` hook returns for the operations staged so far. */
export async function stageBeforeCommit<GenericConfig extends AnyDialecteConfig>(params: {
	hooks: TransactionHooks<GenericConfig> | undefined
	context: Context<GenericConfig>
	query: Query<GenericConfig>
}): Promise<void> {
	const { hooks, context, query } = params
	if (!hooks?.beforeCommit) return
	const operations = await hooks.beforeCommit({ operations: context.stagedOperations.log, query })
	stageOperations({ context, operations })
}
