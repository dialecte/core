import { benchConfig, createWriteBackSession } from './bench-import-session'
import { AFTER_IMPORT_RATIOS, FIXTURE_ROOTS, PORT_BENCH_DIALECTE } from './bench.constants'

import { defineDialecte } from '@/dialecte'

/** The dialecte the port bench's engine serves: the bench's verbatim config and its write-back session. */
export const PORT_BENCH_ENGINE_DIALECTE = defineDialecte({
	id: PORT_BENCH_DIALECTE.dialecteId,
	version: PORT_BENCH_DIALECTE.dialecteVersion,
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
