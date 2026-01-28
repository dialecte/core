export const DIALECTE_NAMESPACES = {
	default: {
		uri: 'http://dialecte.dev/XML/DEV',
		prefix: '',
	},
	dev: {
		uri: 'http://dialecte.dev/XML/DEV',
		prefix: 'dev',
	},
	ext: {
		uri: 'http://dialecte.dev/XML/DEV-EXT',
		prefix: 'ext',
	},
}

export const XMLNS_DEFAULT_NAMESPACE = `xmlns="${DIALECTE_NAMESPACES.default.uri}"`
export const XMLNS_DEV_NAMESPACE = `xmlns:${DIALECTE_NAMESPACES.dev.prefix}="${DIALECTE_NAMESPACES.dev.uri}"`
export const XMLNS_EXT_NAMESPACE = `xmlns:${DIALECTE_NAMESPACES.ext.prefix}="${DIALECTE_NAMESPACES.ext.uri}"`
export const DEV_CUSTOM_RECORD_ID_ATTRIBUTE_NAME = 'db-id'
export const DEV_ID = `${DIALECTE_NAMESPACES.dev.prefix}:${DEV_CUSTOM_RECORD_ID_ATTRIBUTE_NAME}`
