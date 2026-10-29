import { DIALECTE_TEST_NAMESPACES } from '../constant'
import { createXmlAssertions } from './assert-xml'

import { describe, expect, it } from 'vitest'

const DEFAULT_NS_URI = DIALECTE_TEST_NAMESPACES.default.uri
const EXT_NS_URI = DIALECTE_TEST_NAMESPACES.ext.uri
const EXT_PREFIX = DIALECTE_TEST_NAMESPACES.ext.prefix

// A page's own DOM (what `project.export({ xmlDocument: true })` answers) is queried as it is: the
// assertions take it beside XML text.
const sampleXml = /* xml */ `
	<Root xmlns="${DEFAULT_NS_URI}" xmlns:${EXT_PREFIX}="${EXT_NS_URI}" root="1">
		<A aA="valA">
			<AA_1 aAA_1="v1" />
			<${EXT_PREFIX}:AA_3 ${EXT_PREFIX}:aAA_3="v3" />
		</A>
	</Root>
`

const { assertExpectedElementQueries, assertUnexpectedElementQueries } = createXmlAssertions({
	namespaces: DIALECTE_TEST_NAMESPACES,
})

function parsePageDocument(): Document {
	return new DOMParser().parseFromString(sampleXml, 'application/xml')
}

describe('the XML assertions on a page document', () => {
	it('an element present → found, in the default and the ext namespace', () => {
		assertExpectedElementQueries({
			xmlDocument: parsePageDocument(),
			queries: ['//default:A[@aA="valA"]/default:AA_1[@aAA_1="v1"]', '//ext:AA_3[@ext:aAA_3="v3"]'],
		})
	})

	it('an element missing → the step that failed and the last match, printed formatted', () => {
		expect(() =>
			assertExpectedElementQueries({
				xmlDocument: parsePageDocument(),
				queries: ['//default:A[@aA="valA"]/default:AA_2'],
			}),
		).toThrow(/Failed at step 2\/2[\s\S]*<A aA="valA" xmlns="[^"]+"[^>]*>\n  <AA_1 aAA_1="v1"\/>/)
	})

	it('an element present that should not be → refused, the element printed', () => {
		expect(() =>
			assertUnexpectedElementQueries({
				xmlDocument: parsePageDocument(),
				queries: ['//default:A[@aA="valA"]/default:AA_1'],
			}),
		).toThrow(/should NOT exist[\s\S]*Found:\n<AA_1 aAA_1="v1" xmlns="[^"]+"\/>/)
	})
})
