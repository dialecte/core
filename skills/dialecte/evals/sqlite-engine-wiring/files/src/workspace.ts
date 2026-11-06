import { createProjectFactory } from '@dialecte/core'
import { NSD_DIALECTE } from '@dialecte/nsd'
import { SCL_DIALECTE } from '@dialecte/scl'

const createSclProject = createProjectFactory({ dialecte: SCL_DIALECTE })
const createNsdProject = createProjectFactory({ dialecte: NSD_DIALECTE })

/** Opens the substation's SCL project and the namespace project it reads its data models from. */
export async function openWorkspace(name: string) {
	const scl = await createSclProject({}).open(name)
	const nsd = await createNsdProject({}).open(`${name}-nsd`)
	return { scl, nsd }
}
