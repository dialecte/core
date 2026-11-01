/** How a realm iframe of the cross-realm cases joins the hub. */
export type BootRealmParams = {
	/** Whether the realm can start the project's engine for the hub. */
	canStartEngines: boolean
	/** The engine worker it starts (the test dialecte's when absent). */
	engineUrl?: string
	/** The dialecte version its stores ask for (the test dialecte's when absent). */
	dialecteVersion?: string
	/** Joined through a port its parent hands it (`adoptHubPort`), not on its own. */
	bound?: boolean
	/** Its private file system refused (`getDirectory` rejects), as in a sandboxed or storage-blocked frame. */
	storageRefused?: boolean
}

/** What a test drives a realm iframe through: its hub connection and its stores, one per project. */
export type BrowserRealm = {
	realmId: () => string
	/** The project's store of this realm, opened on first use; refused calls reject with the store's error. */
	registerDocument: (params: { project: string; id: string }) => Promise<void>
	documentIds: (params: { project: string }) => Promise<string[]>
	/** An import through this realm (a file whose session waits on a hold, for the cases that need one). */
	importHeld: (params: {
		project: string
		writeId: string
		file: File
	}) => Promise<{ documentId: string }>
	writeOutcome: (params: { project: string; writeId: string }) => Promise<string>
	/** A record created in a registered document of the project, through a commit. */
	commitRecord: (params: { project: string; documentId: string; id: string }) => Promise<void>
	recordIds: (params: { project: string; documentId: string }) => Promise<string[]>
	/**
	 * An export asked of the project's engine itself under `exportId`, one record per batch; `onFirstProgress`
	 * told once its first batch is written. Settles with the size exported, or the key it was refused with.
	 */
	exportUnder: (params: {
		project: string
		documentId: string
		exportId: string
		onFirstProgress?: () => void
	}) => Promise<number | string>
	/** A port bound to this realm for a child realm, and the unbind that tells the hub the child is gone. */
	createHubPort: () => { port: MessagePort; unbind: () => void }
	/** The page's lifecycle event, as the browser sends it: `freeze`/`resume` on the document, the others on the window. */
	lifecycle: (params: { type: PageLifecycleType; persisted?: boolean }) => void
	/** Each time this realm is welcomed back, a new port made for `child` and posted to it. */
	rebindOnRejoin: (params: { child: Window }) => void
	/** The project's store of this realm listened to from now on (`subscribe`), opened on first use. */
	listen: (params: { project: string }) => Promise<void>
	/** What the project's store told since `listen`: `resync`, or the change's type, document and whose it was. */
	heard: (params: { project: string }) => string[]
	closeStore: (params: { project: string }) => void
	/** The project destroyed through this realm's store, its store closed first (no other realm may hold it). */
	destroyProject: (params: { project: string }) => Promise<void>
	/**
	 * A document registered in the project through a store on the SQLite connector, as a project on `sqlite` storage
	 * opens (the connector choosing the hub or the realm itself), its documents read, the store closed: their ids, or
	 * the key the store was refused with.
	 */
	registerThroughSqlite: (params: { project: string; id: string }) => Promise<string[] | string>
	/** The project destroyed through the SQLite connector, as a project on `sqlite` storage destroys: `destroyed`, or the key. */
	destroyThroughSqlite: (params: { project: string }) => Promise<string>
}

/** A realm iframe of a case, and the realm its module booted. */
export type RealmFrame = { frame: HTMLIFrameElement; realm: BrowserRealm }

/** A child realm iframe bound through a port its parent made, and the unbind that tells the hub it is gone. */
export type BoundChildFrame = RealmFrame & { unbind: () => void }

export type PageLifecycleType = 'freeze' | 'resume' | 'pagehide' | 'pageshow'

/** A realm iframe's window: the realm its module booted. */
export type RealmWindow = Window & { realmReady?: Promise<BrowserRealm> }

/** What a parent posts a bound child iframe: the port it joins the hub through. */
export type HubPortMessage = { type: 'hub-port'; port: MessagePort }
