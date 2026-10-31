import { UNNAMABLE_PARTS } from './store.constants'

import { throwDialecteError } from '@/errors'

/**
 * A project's name and its dialecte's id name what holds it on every store - a directory of the origin's private
 * files, a database, a file: one that is empty, `.` or `..` is refused `PROJECT_NAME_INVALID` before any store of
 * it is built, on every store alike.
 */
export function refuseUnnamableProject(params: { project: string; dialecteId?: string }): void {
	const { project, dialecteId } = params
	const unnamable =
		UNNAMABLE_PARTS.includes(project) ||
		(dialecteId !== undefined && UNNAMABLE_PARTS.includes(dialecteId))
	if (!unnamable) return
	throwDialecteError('PROJECT_NAME_INVALID', {
		detail: `A project cannot be named ${JSON.stringify(project)}${dialecteId === undefined ? '' : ` in dialecte ${JSON.stringify(dialecteId)}`}: neither its name nor its dialecte's id may be empty, \`.\` or \`..\``,
		meta: { project, ...(dialecteId !== undefined && { dialecteId }) },
	})
}
