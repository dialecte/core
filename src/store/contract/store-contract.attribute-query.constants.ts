import { makeRecord } from './store-contract.fixtures'

/** The document the attribute query cases write and read. */
export const DOCUMENT_ID = 'doc-1'

/** Three committed records of tag `A`: `x` and `c` holding `aA="v"`, `m` holding `aA="w"`. */
export const COMMITTED = [
	makeRecord({ id: 'x', tagName: 'A', attributes: [{ name: 'aA', value: 'v' }], parent: null }),
	makeRecord({ id: 'c', tagName: 'A', attributes: [{ name: 'aA', value: 'v' }], parent: null }),
	makeRecord({ id: 'm', tagName: 'A', attributes: [{ name: 'aA', value: 'w' }], parent: null }),
]
