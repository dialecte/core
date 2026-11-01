/**
 * The name of a project's BroadcastChannel, the public event contract (`project.channelName`): every Project of the
 * name posts and listens there when its store announces nothing itself (IndexedDB, a custom store); a Project whose
 * store announces its changes (SQLite, in memory) has a channel of its own (`instance`), where only its listeners hear
 * what it reposts.
 */
export function projectChannelName(params: { name: string; instance?: string }): string {
	const { name, instance } = params
	return instance === undefined
		? `dialecte::project::${name}`
		: `dialecte::project::${name}::${instance}`
}
