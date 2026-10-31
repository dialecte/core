import { runTestCases } from '../run-test-cases'
import { readTestStorage } from './read-test-storage'
import { resolveTestStorage } from './resolve-test-storage'
import { useTestStorage } from './use-test-storage'

import { expect } from 'vitest'

import type { BaseTestCase } from '../run-test-cases.type'
import type { StorageParam } from '@/project'

type TestCase = BaseTestCase & {
	processStorage: StorageParam | undefined
	callStorage: StorageParam | undefined
	expected: StorageParam
}

const IN_MEMORY: StorageParam = { type: 'inMemory' }
const READ_ONLY_IN_MEMORY: StorageParam = { type: 'inMemory', writable: false }
const LOCAL: StorageParam = { type: 'local' }
const SQLITE: StorageParam = { type: 'sqlite' }

const testCases: Record<string, TestCase> = {
	'no default, no call storage → the local store, the project default': {
		processStorage: undefined,
		callStorage: undefined,
		expected: LOCAL,
	},
	'an in-memory default, no call storage → the in-memory store': {
		processStorage: IN_MEMORY,
		callStorage: undefined,
		expected: IN_MEMORY,
	},
	'an in-memory default, a local call storage → the local store': {
		processStorage: IN_MEMORY,
		callStorage: LOCAL,
		expected: LOCAL,
	},
	'an in-memory default, another in-memory call storage → the call one': {
		processStorage: IN_MEMORY,
		callStorage: READ_ONLY_IN_MEMORY,
		expected: READ_ONLY_IN_MEMORY,
	},
	'a sqlite default, no call storage → sqlite (the engine in this process)': {
		processStorage: SQLITE,
		callStorage: undefined,
		expected: SQLITE,
	},
	'a sqlite default, a local call storage → the local store': {
		processStorage: SQLITE,
		callStorage: LOCAL,
		expected: LOCAL,
	},
	'no default, an in-memory call storage → the call one': {
		processStorage: undefined,
		callStorage: IN_MEMORY,
		expected: IN_MEMORY,
	},
}

runTestCases.generic(testCases, function act(testCase) {
	const before = readTestStorage()
	useTestStorage(testCase.processStorage)
	try {
		expect(resolveTestStorage({ storage: testCase.callStorage })).toEqual(testCase.expected)
	} finally {
		useTestStorage(before)
	}
})
