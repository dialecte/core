import { DIALECTE_NAMESPACES } from './constant'
import {
	DEFINITION,
	ROOT_ELEMENT,
	SINGLETON_ELEMENTS,
	ELEMENT_NAMES,
	ATTRIBUTES,
	CHILDREN,
	PARENTS,
	ANCESTORS,
	DESCENDANTS,
} from './generated'

import type { IOConfig, AnyDialecteConfig, DatabaseConfig } from '@/types'

// SCL-specific IO configuration
export const IO_CONFIG = {
	supportedFileExtensions: ['.xml'],
} as const satisfies IOConfig

// SCL database configuration
export const DATABASE_CONFIG = {
	recordSchema: {
		primaryKey: 'id',
		indexes: ['tagName', 'parent.id', 'parent.tagName'],
		compoundIndexes: [['id', 'tagName']],
		arrayIndexes: ['children.id', 'children.tagName'],
	},
	/** @deprecated - kept for old io/ pipeline until Phase 5 removes it */
	tables: {
		xmlElements: {
			name: 'xmlElements',
			schema:
				'id, tagName, [id+tagName], parent.id, parent.tagName, *children.id, *children.tagName',
		},
	},
} as const satisfies DatabaseConfig

export const TEST_DIALECTE_CONFIG = {
	rootElementName: ROOT_ELEMENT,
	singletonElements: SINGLETON_ELEMENTS,
	elements: ELEMENT_NAMES,
	namespaces: DIALECTE_NAMESPACES,
	attributes: ATTRIBUTES,
	children: CHILDREN,
	parents: PARENTS,
	descendants: DESCENDANTS,
	ancestors: ANCESTORS,
	database: DATABASE_CONFIG,
	io: IO_CONFIG,
	definition: DEFINITION,
} as const satisfies AnyDialecteConfig

export type TestDialecteConfig = typeof TEST_DIALECTE_CONFIG
