/**
 * Let the realm's queued messages run first: resolves in a task of the message task source, the one a
 * client's call over a port arrives in, so the calls waiting are served before - never a timer, which
 * the browser may run long after them while the engine works.
 */
export function yieldToMessages(): Promise<void> {
	return new Promise(function waitForTurn(resolve) {
		const channel = new MessageChannel()
		channel.port1.onmessage = function takeTurn() {
			channel.port1.close()
			resolve()
		}
		channel.port2.postMessage(undefined)
	})
}
