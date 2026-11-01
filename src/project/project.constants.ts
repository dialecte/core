/**
 * How long a close waits for the imports and writes in flight before it says, once, what it is waiting for: a
 * close that never ends is a hook or a transaction callback awaiting the Project's own open, close or destroy.
 */
export const CLOSE_WAIT_REPORT_MS = 10_000

/**
 * The most changes of a Project's own its store may have told while a call that will post them runs: past it they
 * are posted at once (a call that runs on, a store written beside the Project, never hold an unbounded list).
 */
export const OWN_CHANGES_TOLD_MAX = 256
