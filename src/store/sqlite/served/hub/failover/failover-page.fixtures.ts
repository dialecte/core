import engineUrl from '../../../../../test/test-dialecte.worker.ts?worker&url'
import { bootRealm } from '../hub.browser.fixtures'

import type { RealmWindow } from '../hub.browser.fixtures.types'

// a page of the failover script: a realm of its own (`?spawn=1` starts engines), or a child bound through a
// port its parent posts (`?bound=1`), on the built engine
const query = new URLSearchParams(location.search)
;(window as RealmWindow).realmReady = bootRealm({
	canStartEngines: query.get('spawn') === '1',
	bound: query.get('bound') === '1',
	engineUrl,
})
