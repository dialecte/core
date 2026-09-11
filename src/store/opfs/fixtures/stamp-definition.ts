import type { AnyDialecteConfig, DialecteHooks } from '@/types'

/**
 * Core test fixture standing in for a dialecte "definition" module (the shape scl
 * will ship): a plain module the worker loads by specifier via `import()`. Its
 * `createHooks` returns hooks that run inside the engine's realm during import.
 * This one stamps every standardized record so a test can prove the hook ran.
 */
export function createHooks(): DialecteHooks<AnyDialecteConfig> {
	return {
		afterStandardizedRecord: ({ record }) => ({ ...record, value: 'STAMPED' }),
	}
}
