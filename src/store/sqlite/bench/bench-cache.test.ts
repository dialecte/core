import { DEFAULT_ENGINE_OPTIONS } from '../engine/engine.constants'
import { cachePragmas } from './bench-variants'
import { SQLITE_DEFAULT_CACHE_PRAGMA } from './bench.constants'

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
		name: "device-sized import cache, the engine's steady cache",
		cache: 'device',
		steadyCache: 'engine',
		expected: {
			importPragma: -DEVICE_KIB,
			steadyPragma: -DEFAULT_ENGINE_OPTIONS.steadyCacheMiB * 1024,
		},
	},
	{
		name: 'no raise during the import: the import runs on the steady cache',
		cache: 'default',
		steadyCache: 'engine',
		expected: {
			importPragma: -DEFAULT_ENGINE_OPTIONS.steadyCacheMiB * 1024,
			steadyPragma: -DEFAULT_ENGINE_OPTIONS.steadyCacheMiB * 1024,
		},
	},
	{
		name: "SQLite's own default as the steady cache",
		cache: 'device',
		steadyCache: 'default',
		expected: { importPragma: -DEVICE_KIB, steadyPragma: SQLITE_DEFAULT_CACHE_PRAGMA },
	},
	{
		name: 'device-sized steady cache',
		cache: 'device',
		steadyCache: 'device',
		expected: { importPragma: -DEVICE_KIB, steadyPragma: -DEVICE_KIB },
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
