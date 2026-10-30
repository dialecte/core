/** The prefix of an engine's Web Lock: one engine at a time holds a project's files. */
export const ENGINE_LOCK_PREFIX = 'dialecte:engine:'

/** What the engine posts on a client port outside the calls' answers (no `id`: Comlink passes it by). */
export const ENGINE_SIGNAL = {
	/** The engine works. */
	heartbeat: 'heartbeat',
	/** The engine runs dialecte code that may take long with nothing to tell: wait for its next message. */
	busy: 'busy',
	/** A tick of a call's progress, for the listener the client registered under its `progressId`. */
	progress: 'progress',
} as const
