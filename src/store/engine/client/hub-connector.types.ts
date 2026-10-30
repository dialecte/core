import type { HubConnection } from '../hub/hub-client.types'

export type HubConnectorParams = {
	/** The project's name. */
	name: string
	/** The realm's connection to the hub. */
	connection: HubConnection
	dialecteId: string
	/** The version of the dialecte this realm runs: the hub refuses an engine of another one. */
	dialecteVersion: string
	/** The address of the dialecte's engine worker: a fresh one destroys the project. */
	engineUrl: string
	/**
	 * How long the destroy's fresh worker has to delete the project (`ENGINE_OPEN_BUDGET_MS` when absent),
	 * the close budget besides to answer; the hub keeps its own budget for opening engines.
	 */
	destroyBudgetMs?: number
	/** How long a call waits on a silent engine (the default when absent). */
	heartbeatTimeoutMs?: number
}
