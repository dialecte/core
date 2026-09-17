/**
 * Replace every uuid value in a serialized document with a stable, first-appearance token
 * (`uuid-1`, `uuid-2`, …). The same uuid always maps to the same token, so relationships — a
 * `templateUuid` pointing at an element's `uuid`, a reference's target — stay visible, while the
 * result no longer depends on the random uuid VALUES.
 *
 * Use it to freeze a document `snapshot` on structure + lineage without mocking `crypto.randomUUID`:
 * `expect(normalizeUuids(xml)).toMatchSnapshot()`. A real structural or lineage change still moves the
 * snapshot; only the opaque random values are tokenized.
 */
const UUID_PATTERN = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi

export function normalizeUuids(text: string): string {
	const tokens = new Map<string, string>()
	return text.replace(UUID_PATTERN, (uuid) => {
		const existing = tokens.get(uuid)
		if (existing) return existing
		const token = `uuid-${tokens.size + 1}`
		tokens.set(uuid, token)
		return token
	})
}
