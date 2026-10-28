/**
 * The name of a project's BroadcastChannel, the public event contract: every Project of the name
 * posts and listens there, and so does the engine that serves the project.
 */
export function projectChannelName(params: { name: string }): string {
	return `dialecte::project::${params.name}`
}
