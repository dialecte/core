import { throwDialecteError } from '@/errors'

/**
 * A view coming back to its project (`expectedCreationId`) and finding none, or one created since under its name:
 * the project was destroyed while it was away - refused `PROJECT_DESTROYED_WHILE_AWAY`, nothing written.
 */
export function refuseOtherCreation(params: {
	project: string
	expectedCreationId: string | undefined
	creationId: string | undefined
}): void {
	const { project, expectedCreationId, creationId } = params
	if (expectedCreationId === undefined || creationId === expectedCreationId) return
	throwDialecteError('PROJECT_DESTROYED_WHILE_AWAY', {
		detail: `Project "${project}" was destroyed while this view was away${creationId === undefined ? '' : ', and made again since'}: nothing of it was opened`,
		meta: { project },
	})
}
