import { TEST_DIALECTE } from './test-dialecte'

import { serveSqliteEngine } from '@/sqlite'

serveSqliteEngine({ dialectes: [TEST_DIALECTE] })
