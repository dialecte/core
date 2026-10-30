import { serveHub } from './hub-shell'

import type { SharedWorkerScope } from './hub-shell.types'

const hub = serveHub()
;(self as unknown as SharedWorkerScope).onconnect = function acceptRealm(event: MessageEvent) {
	for (const port of event.ports) hub.connect({ port })
}
