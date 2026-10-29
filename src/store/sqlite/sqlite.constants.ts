/** The VFSes of sqlite-wasm the engine never uses: not installed (they would only warn where they cannot run). */
export const SQLITE_VFS_DISABLED = { opfs: true, 'opfs-vfs': true, 'opfs-wl': true } as const
