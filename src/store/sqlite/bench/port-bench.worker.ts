/**
 * The engine the port bench talks to: the bench's verbatim config and its write-back session, served as
 * a dialecte's worker entry serves its engine (the page reaches it through the store's port).
 */
import { PORT_BENCH_ENGINE_DIALECTE } from './port-bench.worker.constants'

import { serveSqliteEngine } from '@/sqlite'

serveSqliteEngine({ dialectes: [PORT_BENCH_ENGINE_DIALECTE] })
