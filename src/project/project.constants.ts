/**
 * How long a close waits for the imports and writes in flight before it says, once, what it is waiting for: a
 * close that never ends is a hook or a transaction callback awaiting the Project's own open, close or destroy.
 */
export const CLOSE_WAIT_REPORT_MS = 10_000
