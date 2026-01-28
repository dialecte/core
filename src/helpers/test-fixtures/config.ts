import { DIALECTE_NAMESPACES } from './constant'
import {
	DEFINITION,
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
	tables: {
		xmlElements: {
			name: 'xmlElements',
			schema:
				'id, tagName, [id+tagName], parent.id, parent.tagName, *children.id, *children.tagName',
		},
	},
} as const satisfies DatabaseConfig

export const TEST_DIALECTE_CONFIG = {
	rootElementName: 'Root',
	singletonElements: ['Root', 'A', 'B', 'C', 'D'],
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
	hooks: {},
	extensions: {},
} as const satisfies AnyDialecteConfig
