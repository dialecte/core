import { throwDialecteError } from '@/errors'

/**
 * What an open finds of its project, checked against what its opener expects: a view coming back
 * (`expectedCreationId`) finding none, or one created since under its name, is refused
 * `PROJECT_DESTROYED_WHILE_AWAY` (the project was destroyed while it was away); an open that must find its project
 * (`mustExist`, a `{ create: false }` open) finding none is refused `PROJECT_NOT_FOUND`. Nothing is written either way.
 * `creationId` is the creation id of the project found, `undefined` when there is none.
 */
export function refuseOtherCreation(params: {
	project: string
	expectedCreationId: string | undefined
	mustExist?: boolean
	creationId: string | undefined
}): void {
	const { project, expectedCreationId, mustExist = false, creationId } = params
	if (expectedCreationId === undefined) {
		if (mustExist) refuseMissingProject({ project, exists: creationId !== undefined })
		return
	}
	if (creationId === expectedCreationId) return
	throwDialecteError('PROJECT_DESTROYED_WHILE_AWAY', {
		detail: `Project "${project}" was destroyed while this view was away${creationId === undefined ? '' : ', and made again since'}: nothing of it was opened`,
		meta: { project },
	})
}

/**
 * An open that must find its project (`{ create: false }`) refused `PROJECT_NOT_FOUND` when it is not there (never
 * made, destroyed, or its storage cleared); nothing is written. A store with no creation id says whether it found one.
 */
export function refuseMissingProject(params: { project: string; exists: boolean }): void {
	const { project, exists } = params
	if (exists) return
	throwDialecteError('PROJECT_NOT_FOUND', {
		detail: `Project "${project}" does not exist (never made, or its storage was cleared): nothing was made in its place`,
		meta: { project },
	})
}
