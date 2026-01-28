import type { DialecteState } from './types'

/**
 * Shared Dialecte state - mutable object
 * that can be wrapped into reactive on consumer side
 */
const _initialState: DialecteState = {
	loading: false,
	error: null,
	progress: null,
}

/**
 * Update state with partial changes
 * Used internally by other helpers
 */
function updateState(updates: Partial<DialecteState>): void {
	Object.assign(_initialState, updates)
}

/**
 * Mark SDK as loading and optionally set initial progress
 */
function setLoading(operation?: string): void {
	updateState({
		loading: true,
		error: null,
		progress: operation ? { phase: 'executing', operation } : { phase: 'starting' },
	})
}

/**
 * Mark SDK as not loading and clear progress
 */
function setIdle(): void {
	updateState({
		loading: false,
		progress: null,
	})
}

/**
 * Set error state
 */
function setError(error: Error): void {
	updateState({
		loading: false,
		error,
		progress: null,
	})
}

/**
 * Update operation message during execution phase (shows spinner)
 * Use this in chain methods to report what they're doing
 */
function setOperation(operation: string): void {
	updateState({
		loading: true,
		progress: { phase: 'executing', operation },
	})
}

/**
 * Update progress during ending phase
 * Call this as you complete each step
 */
function updateEndingProgress(params: {
	current: number
	total: number
	operation?: string
}): void {
	const { current, total, operation } = params

	const currentProgress = _initialState.progress
	if (!currentProgress || currentProgress.phase !== 'ending')
		updateState({
			loading: true,
			progress: {
				phase: 'ending',
				current: 0,
				total,
				operation: operation || 'Ending',
			},
		})
	else
		updateState({
			progress: {
				...currentProgress,
				current: current,
				operation: operation ?? currentProgress.operation,
			},
		})
}

/**
 * Complete the operation successfully
 * If in ending phase, shows 100% progress
 */
function setComplete(): void {
	const currentProgress = _initialState.progress

	if (currentProgress?.phase === 'ending') {
		updateState({
			loading: false,
			progress: {
				...currentProgress,
				current: currentProgress.total,
			},
		})
	}
}

/**
 * Exported state management helpers
 */
export const dialecteState = {
	setLoading,
	setIdle,
	setError,
	setOperation,
	updateEndingProgress,
	setComplete,
}

/**
 * Get current state (for reading)
 * In Vue: wrap with reactive(getState()) or toRefs(getState())
 */
export function getState(): DialecteState {
	return _initialState
}

/**
 * Reset state to initial values
 */
export function resetState(): void {
	updateState({
		loading: false,
		error: null,
		progress: null,
	})
}
