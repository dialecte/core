import { DexieStore } from './dexie-store'

import { describe, it, expect } from 'vitest'

import { createPerf } from '@/perf'

import type { DocumentRecord } from '@/project'
import type { AnyRawRecord } from '@/types/records'

function uniqueName(): string {
	return `perf-dexie-store-${crypto.randomUUID()}`
}

function makeFile(): DocumentRecord {
	return {
		id: crypto.randomUUID(),
		name: 'perf-file',
		extension: '.scd',
		configKey: 'scl',
		createdAt: Date.now(),
	}
}

function makeRecord(overrides?: Partial<AnyRawRecord>): AnyRawRecord {
	return { id: crypto.randomUUID(), tagName: 'LNode', parentId: null, ...overrides } as AnyRawRecord
}

describe('DexieStore perf instrumentation', () => {
	it('emits reopenSchema + bulkWrite::add spans when a perf helper is provided', async () => {
		const perf = createPerf({ enabled: true })
		perf.reset()
		const store = new DexieStore(uniqueName(), { perf })
		await store.open()
		try {
			const file = makeFile()
			await store.registerDocument(file) // → reopenWithNewSchema (Dexie close+reopen)
			await store.bulkWrite(file.id, { creates: [makeRecord()] }) // → bulkAdd

			const report = perf.report()
			expect(report['core::store::reopenSchema']?.calls).toBeGreaterThanOrEqual(1)
			expect(report['core::store::bulkWrite::add']?.calls).toBeGreaterThanOrEqual(1)
		} finally {
			await store.destroy()
		}
	})

	it('does nothing when no perf helper is provided (default no-op)', async () => {
		const store = new DexieStore(uniqueName())
		await store.open()
		try {
			const file = makeFile()
			await store.registerDocument(file)
			await store.bulkWrite(file.id, { creates: [makeRecord()] })
			// no assertion beyond "does not throw" — the default perf is the frozen no-op
		} finally {
			await store.destroy()
		}
	})
})
