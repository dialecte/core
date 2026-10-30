/** XML text that is not well-formed: `<label>: malformed XML - <line>:<column> <reason>`. */
export class MalformedXmlError extends Error {
	constructor(message: string) {
		super(message)
		this.name = 'MalformedXmlError'
	}
}
