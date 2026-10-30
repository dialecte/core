import { expectRejectsWith } from './contract/store-contract.fixtures'
import { toJsonCopy } from './json-values'
import { JSON_VALUE_MEMBERS } from './json-values.fixtures'

import { afterEach, describe, expect, it } from 'vitest'

// What only a page holds: `document.all`, which reads as undefined, and the values of another realm (a frame's).

/** The global object of a new frame, removed after the test. */
function otherRealm(params: { frames: HTMLIFrameElement[] }): typeof globalThis {
	const frame = document.createElement('iframe')
	document.body.append(frame)
	params.frames.push(frame)
	return frame.contentWindow as unknown as typeof globalThis
}

for (const [memberName, member] of Object.entries(JSON_VALUE_MEMBERS)) {
	describe(memberName, () => {
		const frames: HTMLIFrameElement[] = []
		afterEach(() => {
			for (const frame of frames.splice(0)) frame.remove()
		})

		it('document.all, which reads as undefined → refused by its class', async () => {
			const value = { held: document.all }
			await expectRejectsWith({
				action: Promise.resolve().then(function walk() {
					return member(value)
				}),
				key: 'STORE_VALUE_NOT_JSON',
				detail: /^an instance of HTMLAllCollection is not a JSON value \(field "held"\)$/,
			})
		})

		it('a Date of another realm → refused', async () => {
			const value = { at: new (otherRealm({ frames }).Date)(0) }
			await expectRejectsWith({
				action: Promise.resolve().then(function walk() {
					return member(value)
				}),
				key: 'STORE_VALUE_NOT_JSON',
				detail: /^an instance of Date is not a JSON value \(field "at"\)$/,
			})
		})
	})
}

describe('toJsonCopy - values of another realm', () => {
	const frames: HTMLIFrameElement[] = []
	afterEach(() => {
		for (const frame of frames.splice(0)) frame.remove()
	})

	it('a plain object and an array of another realm → copied as this realm’s', () => {
		const realm = otherRealm({ frames })
		const value = realm.JSON.parse('{"list":[1],"held":{"a":"x"}}') as {
			list: unknown[]
			held: object
		}
		const copy = toJsonCopy({ value })
		expect(copy).toStrictEqual({ list: [1], held: { a: 'x' } })
		expect(Object.getPrototypeOf(copy.list)).toBe(Array.prototype)
		expect(Object.getPrototypeOf(copy.held)).toBe(Object.prototype)
	})
})
