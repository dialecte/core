/**
 * How long one of core's tests waits to see that a message changed nothing: a message crosses a port or a channel
 * in well under this on a loaded machine. A test waiting for a message waits for it (`vi.waitFor`) instead.
 */
export const SILENCE_WAIT_MS = 100

/**
 * How long a test reading every source file of the package may take: the read grows with the repository and slows
 * down many times over when other suites load the machine, so the bound carries wide slack.
 */
export const SOURCE_SCAN_TIMEOUT_MS = 30_000

/** How long a test compiling the test entry with the TypeScript API may take: it loads the package's sources. */
export const TEST_ENTRY_COMPILE_TIMEOUT_MS = 120_000

/** How long a test building the test entry with the package's vite settings may take (in memory). */
export const TEST_ENTRY_BUNDLE_TIMEOUT_MS = 120_000
