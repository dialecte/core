// The setup of the `node-indexeddb-documents` test project: IndexedDB given to node by fake-indexeddb, and the test
// helpers opening their projects on it (the local store), as a runner on IndexedDB chooses it.
import 'fake-indexeddb/auto'
import { useTestStorage } from '@/test'

useTestStorage({ type: 'local' })
