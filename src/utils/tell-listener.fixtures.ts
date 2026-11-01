import { onTestFinished, vi } from 'vitest'

import type { MockInstance } from 'vitest'

/** The console's error reports of the case, kept quiet - what a failing listener reports is the case's to check; restored after it. */
export function quietReports(): MockInstance<(...data: unknown[]) => void> {
	const reported = vi.spyOn(console, 'error').mockImplementation(function quiet() {})
	onTestFinished(function restoreConsole() {
		reported.mockRestore()
	})
	return reported
}

/** The errors the case's reports carry: each report's last argument, what was thrown. */
export function reportedFailures(params: {
	reports: MockInstance<(...data: unknown[]) => void>
}): unknown[] {
	return params.reports.mock.calls.map(function thrownOf(call) {
		return call.at(-1)
	})
}
