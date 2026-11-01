import { tellListener } from '@/utils/tell-listener'
import { TOLD_OF } from '@/utils/tell-listener.constants'

/**
 * A commit's progress as every store tells it, once its records are written: after its creates, its
 * updates and its deletes, each time out of all of them. The listener is never awaited; its failure
 * is reported on the console, the commit stands whole.
 */
export function tellCommitProgress(params: {
	onProgress: ((current: number, total: number) => unknown) | undefined
	parts: readonly number[]
}): void {
	const { onProgress, parts } = params
	const total = parts.reduce((sum, part) => sum + part, 0)
	let written = 0
	for (const part of parts) {
		written += part
		tellListener({
			listener: function tellProgress(current: number) {
				return onProgress?.(current, total)
			},
			value: written,
			of: TOLD_OF.commitProgress,
		})
	}
}
