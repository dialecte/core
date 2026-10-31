import { sqliteEngineSettings } from '../../sqlite/adapter/sqlite-engine-settings'

import { onTestFinished } from 'vitest'

import type { FakePage } from './hub.fixtures.types'

/** A page whose lifecycle events a case fires: `freeze` / `resume` on its document, `pagehide` / `pageshow` on its window. */
export function fakePage(): FakePage {
	const page = new EventTarget()
	const window = new EventTarget()
	return {
		page,
		window,
		freeze: function freezePage() {
			page.dispatchEvent(new Event('freeze'))
		},
		resume: function resumePage() {
			page.dispatchEvent(new Event('resume'))
		},
		hide: function hidePage({ persisted }) {
			window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted }))
		},
		show: function showPage() {
			window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }))
		},
	}
}

/**
 * A worker that opens nothing: it answers every `open` refused, with what it was asked to open with as the
 * refusal's value - so a case reads what the host sent.
 */
export function recordingEngineUrl(): string {
	const source = [
		'self.onmessage = function answerOpen(event) {',
		'	const request = event.data',
		"	if (request?.type !== 'open') return",
		"	self.postMessage({ type: 'failed', requestId: request.requestId, thrown: { kind: 'value', value: { dialecteId: request.dialecteId, perf: request.perf, settings: request.settings } } })",
		'}',
	].join('\n')
	const url = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }))
	onTestFinished(function revokeUrl() {
		URL.revokeObjectURL(url)
	})
	return url
}

/** What the cases' engines open with: the consumer's wasm, as a page gives it. */
export async function loadSettings(): Promise<unknown> {
	return sqliteEngineSettings()
}
