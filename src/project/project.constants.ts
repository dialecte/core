/**
 * How long a close waits for the imports and writes in flight before it says, once, what it is waiting for: a
 * close that never ends is a hook or a transaction callback awaiting the Project's own open, close or destroy.
 */
export const CLOSE_WAIT_REPORT_MS = 10_000

/**
 * The most changes a Project holds before it folds them: its own told while a call that will post them runs (past
 * it, posted at once), and every change told while it opens (past it, its state read again once open). A call that
 * runs on, a store written beside the Project, a long open, never hold an unbounded list.
 */
export const CHANGES_HELD_MAX = 256

/**
 * The most refs a commit message tells: past it, its changes are `{ unknown: true }` (a view patching that many
 * records reads again anyway, and the message crossing a BroadcastChannel stays bounded).
 */
export const COMMIT_CHANGES_MAX = 5_000
