// The setup of the `node-sqlite` test project: the test helpers open their projects on the SQLite engine, the kind
// `@dialecte/core/sqlite` registers (as a dialecte's runner imports it in its setup file).
import '@/sqlite'
import { useTestStorage } from '@/test'

useTestStorage({ type: 'sqlite' })
