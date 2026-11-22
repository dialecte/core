import type { Project } from '@/project/project'
import type { AnyDialecteConfig } from '@/types'

/**
 * Settles once the project's document heard its next change to the end (a commit, an undo, a change another view made
 * and the project folded in): by then the project has moved what its reads keep. Call it before the change is made.
 *
 * @intent wait until a project has heard a change in a test
 */
export function waitForChange(params: {
	project: Project<AnyDialecteConfig>
	documentId: string
}): Promise<void> {
	const { project, documentId } = params
	return new Promise(function waitForTheEnd(resolve) {
		const stop = project.openDocument(documentId).subscribe(function told(terminal) {
			if (!terminal) return
			stop()
			resolve()
		})
	})
}
