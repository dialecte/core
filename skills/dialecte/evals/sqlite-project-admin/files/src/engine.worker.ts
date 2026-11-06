import { serveSqliteEngine } from '@dialecte/core/sqlite'
import { SCL_DIALECTE } from '@dialecte/scl'

serveSqliteEngine({ dialectes: [SCL_DIALECTE] })
