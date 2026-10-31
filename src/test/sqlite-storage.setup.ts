// The setup of the `node-sqlite` test project: the test helpers open their projects on the SQLite engine.
import { useTestStorage } from '@/test'

useTestStorage({ type: 'sqlite' })
