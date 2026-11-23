import type { HubConnection } from '../hub/hub-client.types'

export type HubConnectorParams = {
	/** The project's name. */
	name: string
	/** The realm's connection to the hub. */
	connection: HubConnection
	dialecteId: string
	/** The version of the dialecte this realm runs: the hub refuses an engine of another one. */
	dialecteVersion: string
	/**
	 * The address of the engine worker this realm can start: a fresh one deletes the project's files on a destroy. None
	 * (a realm that cannot store, or a child bound by its page that registered no engine for the dialecte): the hub has
	 * a view that runs an engine of the dialecte delete them.
	 */
	engineUrl?: string
	/**
	 * How long the destroy's fresh worker has to delete the project (`ENGINE_OPEN_BUDGET_MS` when absent),
	 * that worker answering within `max(ENGINE_OPEN_WINDOW_MS, destroyBudgetMs + ENGINE_CLOSE_BUDGET_MS)`, else
	 * ended: `PROJECT_DESTROY_FAILED`. The hub holds the opens of the project that long for the default budget
	 * (`HUB_HELD_OPEN_BUDGET_MS`); it keeps its own budget for opening engines.
	 */
	destroyBudgetMs?: number
	/** How long a call waits on a silent engine (the default when absent). */
	heartbeatTimeoutMs?: number
}
