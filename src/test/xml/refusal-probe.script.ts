import { selectNodes } from './select-nodes'
import { withXmlDocument } from './with-xml-document'

/**
 * Run in a child process by refusal-output.test.ts, which reads what the process writes.
 * `seam`: refuse the expression through the seam (exit 0 when the error names it).
 * `control`: let the raw engine fail on it, which makes libxml2 write to the output.
 */
const [mode, expression] = process.argv.slice(2)
const EXIT_NOT_REFUSED = 3

function refuseThroughSeam(): number {
	try {
		withXmlDocument(
			{ xml: '<Root xmlns="urn:default"/>', label: 'probe' },
			function read(document) {
				return selectNodes({
					context: document,
					expression,
					namespaces: { default: 'urn:default' },
				})
			},
		)
	} catch (error) {
		return (error as Error).message.includes(expression) ? 0 : EXIT_NOT_REFUSED
	}
	return EXIT_NOT_REFUSED
}

// loaded only here: the seam run never has the engine imported ahead of it, whatever the order of the imports
async function failOnTheRawEngine(): Promise<number> {
	const { XmlDocument } = await import('libxml2-wasm')
	const document = XmlDocument.fromString('<Root xmlns="urn:default"/>')
	try {
		document.eval(expression, {})
	} catch {
		return 0
	} finally {
		document.dispose()
	}
	return EXIT_NOT_REFUSED
}

process.exitCode = mode === 'seam' ? refuseThroughSeam() : await failOnTheRawEngine()
