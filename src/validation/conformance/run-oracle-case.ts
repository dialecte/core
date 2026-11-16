import { compareVerdicts } from './compare-verdicts'
import { judgeWithLibxml2 } from './judge-with-libxml2'
import { recordIdsByLine } from './record-lines'
import { scanValues } from './scan-values'

import { throwDialecteError } from '@/errors'
import { createTestProject } from '@/test'

import type { OracleCase } from './conformance.types'

/**
 * Runs one case: libxml2 judges the document, the engine's value scan judges the imported records, and the engine
 * must flag exactly the records libxml2 flags, each with exactly the case's code and attribute.
 *
 * @throws on a mismatch, printing libxml2's message and path; on a `'valid'` case libxml2 refuses ("its base is refused")
 */
export async function runOracleCase(params: { oracleCase: OracleCase }): Promise<void> {
	const { name, document: caseXml, expected } = params.oracleCase
	const errors = judgeWithLibxml2({ document: caseXml })
	if (expected === 'valid' && errors.length > 0) {
		const wordings = errors.map(function describeError({ line, message }) {
			return `  line ${line}: ${message.trim()}`
		})
		throwDialecteError('ASSERTION_FAILED', {
			detail: [`oracle case '${name}': its base is refused by libxml2`, ...wordings].join('\n'),
		})
	}
	const idsByLine = recordIdsByLine({ document: caseXml })
	const { source } = await createTestProject({ sourceXml: caseXml })
	const flagged = await scanValues({ document: source.document })
	compareVerdicts({ name, errors, idsByLine, flagged, expected })
}
