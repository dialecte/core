import { EMPTY_PREFIX_BINDING_PATTERN } from './xml-dom.constants'

// the default import: sax is CommonJS, and Node's ESM loader finds none of its named exports
import sax from 'sax'

/**
 * Why XML text is not well-formed in the sense of XML 1.0 and the XML namespaces, `undefined` when it is: a strict
 * streaming parse (a bare `&`, a tag closed by another name, an unbound prefix) and a prefix bound to no namespace
 * (`xmlns:p=""`), which only XML namespaces 1.1 allows. What the pure-JS DOM lets through, a browser refuses.
 */
// Not caught: `]]>` in a text value, which XML 1.0 does not allow there and a browser refuses. Core's XML writer
// escapes `>`, so no export holds it; a hand-written fixture could.
export function findWellFormednessError(params: { xml: string }): string | undefined {
	const { xml } = params
	const parser = sax.parser(true, { xmlns: true, position: true })
	const problems: string[] = []
	parser.onerror = function recordFirstProblem(error) {
		problems.push(error.message.split('\n')[0] ?? error.message)
		throw error
	}
	parser.onattribute = function checkPrefixBinding(attribute) {
		if (EMPTY_PREFIX_BINDING_PATTERN.test(attribute.name) && attribute.value === '') {
			problems.push(`the prefix of ${attribute.name}="" is bound to no namespace`)
			throw new Error(problems[0])
		}
	}
	try {
		parser.write(xml).close()
	} catch (error) {
		return problems[0] ?? (error as Error).message
	}
	return undefined
}
