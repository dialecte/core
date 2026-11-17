import type { Document } from '@/document'
import type { TestDialecteConfig } from '@/test'

/** The document the scenario benches read: imported from the generated stress fixture, dev perf on. */
export type ScenarioDocument = Document<TestDialecteConfig>

/** The `core::store::*` tallies of one scenario: store calls by member, and `records.<member>` the records they moved. */
export type StoreTallies = Record<string, number>

/** The (tag, id) of every record the store answered during one fetch, in order, repeats kept. */
export type ReadLog = { keys: string[] }

/** What one fetch re-read: records moved, the distinct (tag, id) among them, and the reads beyond the first of each. */
export type FetchRepeats = { moved: number; distinct: number; repeated: number }

/** The frozen result of the scenario benches on one generated stress fixture. */
export type ScenarioBaseline = {
	fixture: { records: number; elementsPerScenario: number }
	scenarios: Record<string, StoreTallies>
	fetchRepeats: FetchRepeats
}
