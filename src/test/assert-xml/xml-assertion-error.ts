/**
 * A behaviour miss of the XML query assertions: an expected element absent or an unexpected one present.
 * Named `AssertionError` so a test runner and tools read it as an assertion failure, not a test error.
 */
export class XmlAssertionError extends Error {
	constructor(message: string) {
		super(message)
		this.name = 'AssertionError'
	}
}
