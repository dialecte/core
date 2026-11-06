import { CONTRACT_SESSION_TAG } from '../../contract/store-contract.constants'
import { benchConfig } from '../bench/bench-import-session'

import { createDiagnostic } from '@/diagnostics'
import { defineDialecte } from '@/dialecte'
import { TEST_DIALECTE_CONFIG } from '@/test/config'

import type { DiagnosticCatalogue } from '@/diagnostics'
import type { AnyRawRecord } from '@/types'

/**
 * A fixture dialecte besides the test dialecte: another id and version, a config of its own (its own key, typed apart
 * from the first's, its own default namespace) and hooks whose import session says its diagnostics under the
 * catalogue's source - what an import and an export through it show. Declared here for both sides: the engine worker
 * serves it, the page opens its projects and registers it.
 */
export function declareFixtureDialecte(params: {
	id: string
	version: string
	configKey: string
	namespaceUri: string
	diagnostics: DiagnosticCatalogue
}) {
	const { id, version, configKey, namespaceUri, diagnostics } = params
	return defineDialecte({
		id,
		version,
		configs: {
			[configKey]: benchConfig({
				rootElementName: TEST_DIALECTE_CONFIG.rootElementName,
				namespaceUri,
			}),
		},
		defaultConfigKey: configKey,
		createHooks: function createFixtureHooks() {
			return {
				createImportSession: function createFixtureSession() {
					const handed: AnyRawRecord[] = []
					return {
						recordTagNames: [CONTRACT_SESSION_TAG],
						beforeImportRecord: function noteRecord({ record }) {
							handed.push(record)
						},
						afterImport: async function sayWhatWasSeen() {
							return {
								diagnostics: handed.map(function seenByFixture(record) {
									return createDiagnostic(diagnostics, 'seen', {
										ref: { tagName: record.tagName, id: record.id },
									})
								}),
							}
						},
					}
				},
			}
		},
	})
}
