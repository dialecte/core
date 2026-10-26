import { cachePragmas } from './bench-variants'
import { KILL_VARIANT, SQLITE_DEFAULT_CACHE_PRAGMA, VARIANTS } from './bench.constants'

import { describe, expect, it } from 'vitest'

import type { BenchCache, BenchSteadyCache } from './bench.types'

const DEVICE_KIB = 512 * 1024

const cases: Array<{
	name: string
	cache: BenchCache
	steadyCache: BenchSteadyCache
	expected: { importPragma: number; steadyPragma: number }
}> = [
	{
		name: "device-sized import cache, the engine's steady cache: the same device rule",
		cache: 'device',
		steadyCache: 'engine',
		expected: {
			importPragma: -DEVICE_KIB,
			steadyPragma: -DEVICE_KIB,
		},
	},
	{
		name: 'the cache-default arm: no raise, the import on the 64 MiB steady cache its recorded runs used',
		cache: VARIANTS.cacheDefault.cache,
		steadyCache: VARIANTS.cacheDefault.steadyCache,
		expected: { importPragma: -64 * 1024, steadyPragma: -64 * 1024 },
	},
	{
		name: 'the kill arm: a 2 MiB import cache that spills in every window, the 64 MiB steady cache',
		cache: KILL_VARIANT.cache,
		steadyCache: KILL_VARIANT.steadyCache,
		expected: { importPragma: -2 * 1024, steadyPragma: -64 * 1024 },
	},
	{
		name: 'the kill arm reopened after the kill (the device size passed): the same 64 MiB steady cache',
		cache: KILL_VARIANT.cache,
		steadyCache: KILL_VARIANT.steadyCache,
		expected: { importPragma: -2 * 1024, steadyPragma: -64 * 1024 },
	},
	{
		name: "SQLite's own default as the steady cache",
		cache: 'device',
		steadyCache: 'default',
		expected: { importPragma: -DEVICE_KIB, steadyPragma: SQLITE_DEFAULT_CACHE_PRAGMA },
	},
	{
		name: 'explicit sizes in MiB for both caches',
		cache: { mib: 1536 },
		steadyCache: { mib: 1536 },
		expected: { importPragma: -1536 * 1024, steadyPragma: -1536 * 1024 },
	},
	{
		name: 'an explicit steady cache is also what an import without a raise uses',
		cache: 'default',
		steadyCache: { mib: 256 },
		expected: { importPragma: -256 * 1024, steadyPragma: -256 * 1024 },
	},
]

describe('cachePragmas: a variant cache setting as SQLite cache_size values (negative = KiB)', () => {
	it.each(cases)('$name', ({ cache, steadyCache, expected }) => {
		expect(cachePragmas({ cache, steadyCache, deviceCacheKiB: DEVICE_KIB })).toEqual(expected)
	})
})
