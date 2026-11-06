import { createClosingConnections } from '../../closing-connections'

/** The stores of each name in this realm closed with operations running: a destroy of the name waits for those. */
export const CLOSING_ENGINE_STORES = createClosingConnections()
