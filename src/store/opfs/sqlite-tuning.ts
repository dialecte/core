/**
 * SQLite runtime tuning helpers.
 *
 * The page cache holds DB pages in RAM; a bigger cache keeps a bulk import's
 * working set resident instead of spilling to random OPFS I/O. We size it to the
 * device's RAM so a low-memory laptop is never asked to reserve a fixed 512 MiB.
 */

const CACHE_FLOOR_MIB = 64
const CACHE_CEILING_MIB = 512
const MIB_PER_GIB_OF_RAM = 64 // ~1/16 of device RAM budgeted to the page cache
const DEFAULT_DEVICE_MEMORY_GIB = 4

/**
 * SQLite `cache_size` value (in KiB, to pass as a negative PRAGMA) sized to the
 * device's approximate RAM (`navigator.deviceMemory`). Clamped to [64, 512] MiB;
 * unknown/invalid input falls back to a 4 GiB device.
 */
export function pageCacheSizeKiB(deviceMemoryGb: number | undefined): number {
	const gib = deviceMemoryGb && deviceMemoryGb > 0 ? deviceMemoryGb : DEFAULT_DEVICE_MEMORY_GIB
	const mib = Math.min(
		CACHE_CEILING_MIB,
		Math.max(CACHE_FLOOR_MIB, Math.round(gib * MIB_PER_GIB_OF_RAM)),
	)
	return mib * 1024
}

const INDEX_BUILD_CEILING_KIB = 1024 * 1024 // 1 GiB cap for the one-shot index build

/**
 * A larger, transient `cache_size` (KiB) used only around the finalize-time index
 * build so building indexes over a large table does not spill to OPFS. Doubles the
 * steady-state cache, capped at 1 GiB. `0` (memory mode) stays `0` — no bump.
 */
export function indexBuildCacheSizeKiB(baseKiB: number): number {
	if (baseKiB <= 0) return 0
	return Math.min(baseKiB * 2, INDEX_BUILD_CEILING_KIB)
}
