import type { EngineLink, LinkNotice } from '../served/engine-store.types'
import type { InProcessFile } from './in-process-link.types'

/**
 * The in-memory project files of this realm, by project key (`projectKeyOf`: dialecte and name): one state
 * per project, as the origin's files are.
 */
export const FILES = new Map<string, InProcessFile>()
/** The connections open on each project, by its key: a destroy of it is refused while one is. */
export const CLIENTS = new Map<string, Set<EngineLink>>()
/** What each connection's store listens with: every change of its project, and each resync. */
export const LISTENERS = new WeakMap<EngineLink, Set<(notice: LinkNotice) => void>>()
