import { DIALECTE_NAMESPACES } from '@/helpers'

export const DIALECTE_TEST_NAMESPACES = {
	...DIALECTE_NAMESPACES,
	default: {
		uri: 'http://dialecte.dev/XML/DEFAULT',
		prefix: '',
	},
	ext: {
		uri: 'http://dialecte.dev/XML/DEV-EXT',
		prefix: 'ext',
	},
}

export const XMLNS_DEFAULT_NAMESPACE = `xmlns="${DIALECTE_TEST_NAMESPACES.default.uri}"`
export const XMLNS_DEV_NAMESPACE = `xmlns:${DIALECTE_TEST_NAMESPACES.dev.prefix}="${DIALECTE_TEST_NAMESPACES.dev.uri}"`
export const XMLNS_EXT_NAMESPACE = `xmlns:${DIALECTE_TEST_NAMESPACES.ext.prefix}="${DIALECTE_TEST_NAMESPACES.ext.uri}"`
