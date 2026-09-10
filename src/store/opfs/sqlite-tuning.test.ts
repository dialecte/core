import { indexBuildCacheSizeKiB, pageCacheSizeKiB } from './sqlite-tuning'

import { describe, expect, it } from 'vitest'

describe('pageCacheSizeKiB — device-aware SQLite page-cache budget', () => {
	it.each([
		[8, 512 * 1024], // high-RAM workstation → ceiling
		[4, 256 * 1024],
		[2, 128 * 1024],
		[1, 64 * 1024], // low-RAM laptop → floor
		[64, 512 * 1024], // absurd value clamps to ceiling
		[undefined, 256 * 1024], // unknown → 4 GiB default
		[0, 256 * 1024], // invalid → default
	])('deviceMemory=%s GiB → %s KiB', (deviceMemoryGb, expected) => {
		expect(pageCacheSizeKiB(deviceMemoryGb)).toBe(expected)
	})
})

describe('indexBuildCacheSizeKiB — transient cache bump for the finalize index build', () => {
	it.each([
		[512 * 1024, 1024 * 1024], // 512 MiB base → 2× = 1 GiB (ceiling)
		[256 * 1024, 512 * 1024], // 256 → 512 MiB
		[64 * 1024, 128 * 1024], // low-RAM base stays modest
		[700 * 1024, 1024 * 1024], // 2× clamps to the 1 GiB ceiling
		[0, 0], // memory mode (no persistent cache) → no bump
	])('base=%s KiB → %s KiB', (baseKiB, expected) => {
		expect(indexBuildCacheSizeKiB(baseKiB)).toBe(expected)
	})
})
