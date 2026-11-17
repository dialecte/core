import type { AnyDialecteConfig, ElementsOf, TrackedRecord } from '@/types'

/** A record as another record names it (a parent or a child link): a tag name and the id it is read by. */
export type RecordLink = {
	readonly tagName: string
	readonly id: string
}

/** The records read during one batch call, by id: each is read once however many inputs reach it. */
export type KnownRecords<GenericConfig extends AnyDialecteConfig> = Map<
	string,
	TrackedRecord<GenericConfig, ElementsOf<GenericConfig>>
>
