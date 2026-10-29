import type { NodePlace } from './xml-dom.types'

/** A place as text: `/0/1` (the child index at each level), then `@{namespace}name` for an attribute. */
export function describePlace(params: { place: NodePlace }): string {
	const { place } = params
	const attribute = place.attribute
		? `@{${place.attribute.namespaceUri ?? ''}}${place.attribute.localName}`
		: ''
	return `/${place.childIndices.join('/')}${attribute}`
}
