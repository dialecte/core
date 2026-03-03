import { DIALECTE_DEV_NAMESPACE } from '@/helpers/constant'

export { CUSTOM_RECORD_ID_ATTRIBUTE, DEV_CUSTOM_RECORD_ID_ATTRIBUTE_NAME } from '@/helpers/constant'

export const DIALECTE_NAMESPACES = {
	default: {
		uri: 'http://dialecte.dev/XML/DEFAULT',
		prefix: '',
	},
	dev: DIALECTE_DEV_NAMESPACE,
	ext: {
		uri: 'http://dialecte.dev/XML/DEV-EXT',
		prefix: 'ext',
	},
}

export const XMLNS_DEFAULT_NAMESPACE = `xmlns="${DIALECTE_NAMESPACES.default.uri}"`
export const XMLNS_DEV_NAMESPACE = `xmlns:${DIALECTE_NAMESPACES.dev.prefix}="${DIALECTE_NAMESPACES.dev.uri}"`
export const XMLNS_EXT_NAMESPACE = `xmlns:${DIALECTE_NAMESPACES.ext.prefix}="${DIALECTE_NAMESPACES.ext.uri}"`
