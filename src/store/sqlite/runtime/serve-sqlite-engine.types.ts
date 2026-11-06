import type { EngineControlRequest } from '../../engine/engine.types'
import type { SqliteEngineSettings } from './runtime.types'
import type { AnyDialecteConfig } from '@/types'

/**
 * A dialecte as an engine worker is given it: what every `defineDialecte` result carries, erased to the
 * config-agnostic shape the engine imports with, so a list of declarations of different configs fits one parameter.
 * The hooks are an object here: their types depend on the config, so those of one dialecte are not those of another;
 * the engine reads them back as the config-agnostic hooks at this one boundary.
 */
export type SqliteEngineDialecte = {
	readonly id: string
	readonly version: string
	readonly configs: Readonly<Record<string, AnyDialecteConfig>>
	readonly defaultConfigKey: string
	readonly createHooks: () => object
}

/** What `serveSqliteEngine` is given: every dialecte of the app, the first declaration of an id being the one found. */
export type ServeSqliteEngineParams = {
	dialectes: readonly SqliteEngineDialecte[]
}

/** Handles one control message of an engine worker and posts its answer. */
export type AnswerEngineControl = (
	request: EngineControlRequest<SqliteEngineSettings>,
) => Promise<void>

/** What the engine's chunk offers the light side of its worker. */
export type SqliteEngineChunk = {
	createSqliteEngineControl: (params: ServeSqliteEngineParams) => AnswerEngineControl
}
