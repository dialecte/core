import { XMLNS_NAMESPACE_URI } from '@/helpers/constant'

import type { XmlAttribute } from './xml-element.types'

/** `xmlns=""`: the declaration that leaves the default namespace, on an element holding a name in no namespace. */
export const NO_DEFAULT_DECLARATION: Readonly<XmlAttribute> = {
	namespaceURI: XMLNS_NAMESPACE_URI,
	prefix: null,
	localName: 'xmlns',
	value: '',
}
