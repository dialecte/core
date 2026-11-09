import { ENGINE_WIRE_MEMBERS } from '../sqlite/served/wire/wire.constants'

import type { EngineConnector, EngineLink } from '../sqlite/served/engine-store.types'
import type { EngineApi } from '../sqlite/served/engine.types'

function isWireMember(property: PropertyKey): property is keyof EngineApi {
	return typeof property === 'string' && Object.hasOwn(ENGINE_WIRE_MEMBERS, property)
}

/** An engine whose members, when called, are noted in `called` first; everything else is the engine's own. */
function recordingEngine(params: { engine: EngineApi; called: Set<keyof EngineApi> }): EngineApi {
	const { engine, called } = params
	return new Proxy(engine, {
		get: function memberOf(target, property, receiver) {
			const value: unknown = Reflect.get(target, property, receiver)
			if (typeof value !== 'function' || !isWireMember(property)) return value
			return function recordedCall(...args: unknown[]) {
				called.add(property)
				return Reflect.apply(value, target, args)
			}
		},
	})
}

/**
 * A connector whose engines note, in `called`, every member a store calls on them; the rest passes through. A destroy
 * given one of its links as the store's own hands the inner connector the inner link it made (a connector knows its
 * links by identity).
 */
export function recordingConnector(params: {
	connector: EngineConnector
	called: Set<keyof EngineApi>
}): EngineConnector {
	const { connector, called } = params
	const innerOf = new WeakMap<EngineLink, EngineLink>()
	return {
		connect: async function connectRecorded() {
			const inner = await connector.connect()
			const recorded: EngineLink = {
				connectionId: inner.connectionId,
				engine: async function recordedEngine() {
					const engine = await inner.engine()
					return recordingEngine({ engine, called })
				},
				onNotice: function onNotice(listener) {
					return inner.onNotice(listener)
				},
				close: function close() {
					return inner.close()
				},
			}
			innerOf.set(recorded, inner)
			return recorded
		},
		destroy: function destroyRecorded(destroyParams) {
			const own = destroyParams?.own
			if (!own) return connector.destroy(destroyParams)
			const link = innerOf.get(own.link) ?? own.link
			return connector.destroy({ ...destroyParams, own: { ...own, link } })
		},
	}
}
