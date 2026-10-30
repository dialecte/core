/**
 * How long one of core's tests waits to see that a message changed nothing: a message crosses a port or a channel
 * in well under this on a loaded machine. A test waiting for a message waits for it (`vi.waitFor`) instead.
 */
export const SILENCE_WAIT_MS = 100
