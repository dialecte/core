export const CUSTOM_RECORD_ID_ATTRIBUTE_NAME = 'db-id'

export const DIALECTE_DEV_NAMESPACE = {
	uri: 'http://dialecte.dev/XML/DEV',
	prefix: 'dev',
}

export const CUSTOM_RECORD_ID_ATTRIBUTE = `${DIALECTE_DEV_NAMESPACE.prefix}:${CUSTOM_RECORD_ID_ATTRIBUTE_NAME}`

export const XSI_NAMESPACE = {
	uri: 'http://www.w3.org/2001/XMLSchema-instance',
	prefix: 'xsi',
}

export const DIALECTE_NAMESPACES = {
	dev: DIALECTE_DEV_NAMESPACE,
	xsi: XSI_NAMESPACE,
}
