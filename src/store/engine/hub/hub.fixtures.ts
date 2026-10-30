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
