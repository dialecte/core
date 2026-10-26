import { DEFAULT_DEVICE_MEMORY_GIB, DEFAULT_ENGINE_OPTIONS } from './engine.constants'

import type { DeviceCacheRule } from './engine.types'

/**
 * The page cache, in MiB, for a device of that much memory (in GiB, as `navigator.deviceMemory`
 * reports it): the rule's MiB per GiB, held between its floor and its ceiling. A device that does
 * not report its memory is sized as a 4 GiB one.
 */
export function deviceCacheMiB(params: {
	deviceMemoryGiB: number | undefined
	rule?: DeviceCacheRule
}): number {
	const { deviceMemoryGiB = DEFAULT_DEVICE_MEMORY_GIB, rule = DEFAULT_ENGINE_OPTIONS.cacheRule } =
		params
	const { mibPerGiB, floorMiB, ceilingMiB } = rule
	return Math.min(ceilingMiB, Math.max(floorMiB, Math.round(deviceMemoryGiB * mibPerGiB)))
}

/** The device's memory as the realm reports it: Chromium does, in a page and in a worker; none elsewhere. */
export function reportedDeviceMemoryGiB(): number | undefined {
	return (globalThis.navigator as { deviceMemory?: number } | undefined)?.deviceMemory
}
