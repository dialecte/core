import type { HubLifecycleTargets } from './hub-client.types'

/** A page's lifecycle a case drives: targets of its own, so no other realm of the run hears it. */
export type FakePage = HubLifecycleTargets & {
	freeze: () => void
	resume: () => void
	hide: (params: { persisted: boolean }) => void
	show: () => void
}
