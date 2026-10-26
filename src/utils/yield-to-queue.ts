/**
 * Let the realm's queue run (a message, a commit of another caller) before going on: a macrotask through a
 * `MessageChannel`, with no timer clamp. Exists in pages, workers and Node.
 */
export function yieldToQueue(): Promise<void> {
	return new Promise(function waitForTurn(resolve) {
		const channel = new MessageChannel()
		channel.port1.onmessage = function resume() {
			channel.port1.close()
			resolve()
		}
		channel.port2.postMessage(null)
	})
}
