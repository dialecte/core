/**
 * The most refs a commit message tells: past it, its changes are `{ unknown: true }` (a view patching that many
 * records reads again anyway, and the message crossing a BroadcastChannel stays bounded).
 */
export const COMMIT_CHANGES_MAX = 5_000
