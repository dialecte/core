import type { BenchMemory, PerformanceWithMemory } from './bench.types'

/** The JS heap figures this realm exposes (Chromium's `performance.memory`; the user-agent measure needs cross-origin isolation). */
export async function realmMemory(): Promise<BenchMemory> {
	const memory: BenchMemory = {}
	const realm = performance as PerformanceWithMemory
	const jsHeap = realm.memory
	if (jsHeap) memory.jsHeapUsedBytes = jsHeap.usedJSHeapSize
	const measure = realm.measureUserAgentSpecificMemory
	if (!measure) memory.userAgentError = 'measureUserAgentSpecificMemory not available'
	else if (!globalThis.crossOriginIsolated) memory.userAgentError = 'not cross-origin isolated'
	else
		await measure.call(performance).then(
			function keepUserAgentBytes(result) {
				memory.userAgentBytes = result.bytes
			},
			function keepUserAgentError(thrown: unknown) {
				memory.userAgentError = String(thrown)
			},
		)
	return memory
}
