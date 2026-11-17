import { VERSIONED_READ_MEMBERS } from './versioned-read.constants'

import { invariant } from '@/utils'

import type { StoreVersion, VersionedAnswer, VersionedRead, VersionedReads } from './store.types'

/**
 * Only for a store whose read members read before their first await; never for one that awaits first. One read
 * member's answer and the document's version, read in the same step: the member is started (such a store has read by
 * then), then the version is read before anything else can run, so a write landing after the read is never paired with
 * its answer. A member that is not a read is refused `ASSERTION_FAILED`, nothing run.
 *
 * @intent implement Store.readVersioned in a custom store, answer a read with the document version of the same moment
 */
export async function runVersionedRead<GenericRead extends VersionedRead>(params: {
	reads: VersionedReads
	read: GenericRead
	versionOf: () => StoreVersion
}): Promise<VersionedAnswer<GenericRead['member']>> {
	const { reads, read, versionOf } = params
	invariant((VERSIONED_READ_MEMBERS as readonly string[]).includes(read.member), {
		detail: `"${read.member}" is not a read a version is answered with`,
		meta: { member: read.member },
	})
	const member = reads[read.member] as (
		...args: GenericRead['args']
	) => Promise<VersionedAnswer<GenericRead['member']>['value']>
	const answer = member.apply(reads, read.args)
	const version = versionOf()
	return { value: await answer, version }
}
