import { ENGINE_CLOSE_BUDGET_MS, ENGINE_OPEN_WINDOW_MS } from './client.constants'

/**
 * How long a realm waits for a worker it spawned to answer the first thing it asked (its open, or a destroy): the
 * open window (`ENGINE_OPEN_WINDOW_MS` when absent), never shorter than the engine's own budget and the close budget
 * to answer. It covers the worker's start - its module and engine loaded, seconds under load.
 */
export function startWindowOf(params: {
	openWindowMs: number | undefined
	budgetMs: number
}): number {
	const { openWindowMs = ENGINE_OPEN_WINDOW_MS, budgetMs } = params
	return Math.max(openWindowMs, budgetMs + ENGINE_CLOSE_BUDGET_MS)
}
