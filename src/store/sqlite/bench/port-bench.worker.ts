/**
 * The engine the port bench talks to: the bench's verbatim config and its write-back session, served as
 * a dialecte's worker entry serves its engine (the page reaches it through the store's port).
 */
import { benchConfig, createWriteBackSession } from './bench-import-session'
import { AFTER_IMPORT_RATIOS, ENGINE_BENCH_DIALECTE_ID, FIXTURE_ROOTS } from './bench.constants'

import { defineDialecte } from '@/dialecte'
import { serveDialecteEngine } from '@/engine'

const PORT_BENCH_DIALECTE = defineDialecte({
	id: ENGINE_BENCH_DIALECTE_ID,
	version: '0.0.0',
	configs: { default: benchConfig(FIXTURE_ROOTS.composed) },
	defaultConfigKey: 'default',
	createHooks: function createBenchHooks() {
		return {
			createImportSession: function createBenchSession() {
				return createWriteBackSession({
					ratio: AFTER_IMPORT_RATIOS.pathNamed,
					onRoot: function ignoreRoot() {},
					timings: { afterImportBuildMs: 0 },
				})
			},
		}
	},
})

serveDialecteEngine({ dialecte: PORT_BENCH_DIALECTE })
