import type { RunningOperations } from './running-operations.types'

/**
 * A count of the operations a store runs, so that `open()` and `destroy()` wait for the ones running:
 * an operation already started completes.
 */
export function createRunningOperations(): RunningOperations {
	let count = 0
	let waiting: Array<() => void> = []
	return {
		get count() {
			return count
		},
		start: function startOperation() {
			count += 1
		},
		end: function endOperation() {
			count -= 1
			if (count > 0) return
			const resolved = waiting
			waiting = []
			for (const resolve of resolved) resolve()
		},
		whenIdle: function whenNoOperationRuns() {
			if (count === 0) return Promise.resolve()
			return new Promise<void>((resolve) => {
				waiting.push(resolve)
			})
		},
	}
}
