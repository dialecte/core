import { describe, expect } from 'vitest'

import { CUSTOM_RECORD_ID_ATTRIBUTE } from '@/helpers'
import {
	DIALECTE_TEST_NAMESPACES,
	XMLNS_DEFAULT_NAMESPACE,
	XMLNS_DEV_NAMESPACE,
	XMLNS_EXT_NAMESPACE,
	runTestCases,
} from '@/test'

import type { AddChildParams } from './create.types'
import type { Ref } from '@/document'
import type { ActParams, ActResult, BaseXmlTestCase, TestCases, TestDialecteConfig } from '@/test'
import type { ElementsOf, ChildrenOf } from '@/types'

describe('stageAddChild', () => {
	const ns = `${XMLNS_DEFAULT_NAMESPACE} ${XMLNS_DEV_NAMESPACE}`
	const nsExt = `${XMLNS_DEFAULT_NAMESPACE} ${XMLNS_DEV_NAMESPACE} ${XMLNS_EXT_NAMESPACE}`
	const customId = CUSTOM_RECORD_ID_ATTRIBUTE

	type TestCase = BaseXmlTestCase & {
		parentRef: Ref<TestDialecteConfig, ElementsOf<TestDialecteConfig>>
		childPayload: AddChildParams<
			TestDialecteConfig,
			ElementsOf<TestDialecteConfig>,
			ChildrenOf<TestDialecteConfig, ElementsOf<TestDialecteConfig>>
		>
		expectThrow?: boolean
	}

	const testCases: TestCases<TestCase> = {
		'add child with attributes → child nested under parent': {
			sourceXml: /* xml */ `
				<Root ${ns}>
					<A ${customId}="a1" aA="parent" />
				</Root>
			`,
			parentRef: { tagName: 'A', id: 'a1' },
			childPayload: { tagName: 'AA_1', attributes: { aAA_1: 'new-child' } },
			expectedQueries: ['//default:A[@aA="parent"]/default:AA_1[@aAA_1="new-child"]'],
		},
		'addChild called → child element exists in exported XML': {
			sourceXml: /* xml */ `
				<Root ${ns}>
					<A ${customId}="a1" aA="parent" />
				</Root>
			`,
			parentRef: { tagName: 'A', id: 'a1' },
			childPayload: { tagName: 'AA_1', attributes: { aAA_1: 'child' } },
			expectedQueries: ['//default:AA_1[@aAA_1="child"]'],
		},
		'child payload with explicit id → child has that id in exported XML': {
			sourceXml: /* xml */ `
				<Root ${ns}>
					<A ${customId}="a1" aA="parent" />
				</Root>
			`,
			parentRef: { tagName: 'A', id: 'a1' },
			childPayload: { tagName: 'AA_1', id: '0-0-0-0-1', attributes: { aAA_1: 'child' } },
			expectedQueries: ['//default:AA_1[@_temp-idb-id="0-0-0-0-1"]'],
		},
		'parent with existing child + addChild → both children present': {
			sourceXml: /* xml */ `
				<Root ${ns}>
					<A ${customId}="a1" aA="parent">
						<AA_1 ${customId}="aa-existing" aAA_1="existing" />
					</A>
				</Root>
			`,
			parentRef: { tagName: 'A', id: 'a1' },
			childPayload: { tagName: 'AA_2', attributes: { aAA_2: 'new' } },
			expectedQueries: [
				'//default:A[@aA="parent"]/default:AA_1[@aAA_1="existing"]',
				'//default:A[@aA="parent"]/default:AA_2[@aAA_2="new"]',
			],
		},
		'addChild on one parent → sibling parent unchanged': {
			sourceXml: /* xml */ `
				<Root ${ns}>
					<A ${customId}="a1" aA="target" />
					<B ${customId}="b1" aB="sibling" />
				</Root>
			`,
			parentRef: { tagName: 'A', id: 'a1' },
			childPayload: { tagName: 'AA_1', attributes: { aAA_1: 'child' } },
			expectedQueries: [
				'//default:A[@aA="target"]/default:AA_1[@aAA_1="child"]',
				'//default:B[@aB="sibling"]',
			],
			unexpectedQueries: ['//default:B/default:AA_1'],
		},
		'deeply nested parent + addChild → child appended at correct depth': {
			sourceXml: /* xml */ `
				<Root ${ns}>
					<A ${customId}="a1" aA="l0">
						<AA_1 ${customId}="aa1" aAA_1="l1">
							<AAA_1 ${customId}="aaa1" aAAA_1="l2" />
						</AA_1>
					</A>
				</Root>
			`,
			parentRef: { tagName: 'AAA_1', id: 'aaa1' },
			childPayload: { tagName: 'AAAA_1', attributes: { aAAAA_1: 'leaf' } },
			expectedQueries: ['//default:AAA_1[@aAAA_1="l2"]/default:AAAA_1[@aAAAA_1="leaf"]'],
		},
		'a child only the leading wildcard admits → exported first, before the declared children': {
			sourceXml: /* xml */ `
				<Root ${nsExt}>
					<C aC="c">
						<CC_2 ${customId}="cc2" aCC_2="parent">
							<CCC_1 aCCC_1="declared" />
						</CC_2>
					</C>
				</Root>
			`,
			parentRef: { tagName: 'CC_2', id: 'cc2' },
			childPayload: { tagName: 'CCCC_3', attributes: { 'ext:aCCCC_3': 'admitted' } },
			expectedQueries: [
				'//default:CC_2/*[1][self::ext:CCCC_3[@ext:aCCCC_3="admitted"]]',
				'//default:CC_2/*[2][self::default:CCC_1]',
			],
		},
		'throws when parent does not exist': {
			sourceXml: /* xml */ `<Root ${ns} />`,
			parentRef: { tagName: 'A', id: 'non-existent' },
			childPayload: { tagName: 'AA_1', attributes: { aAA_1: 'child' } },
			expectThrow: true,
		},
		'full-object attr with local name + namespace → stored as prefixed attribute': {
			sourceXml: /* xml */ `
				<Root ${nsExt}>
					<A ${customId}="a1" aA="parent" />
				</Root>
			`,
			parentRef: { tagName: 'A', id: 'a1' },
			childPayload: {
				tagName: 'AA_1',
				attributes: [
					{ name: 'aAA_1', value: 'req' },
					{ name: 'cAA_1', value: 'qualified', namespace: DIALECTE_TEST_NAMESPACES.ext },
				],
			},
			expectedQueries: [
				'//default:A/default:AA_1[@aAA_1="req"]',
				'//default:A/default:AA_1[@ext:cAA_1="qualified"]',
			],
		},
		'full-object attr with a prefixed name → throws loudly': {
			sourceXml: /* xml */ `
				<Root ${nsExt}>
					<A ${customId}="a1" aA="parent" />
				</Root>
			`,
			parentRef: { tagName: 'A', id: 'a1' },
			childPayload: {
				tagName: 'AA_1',
				attributes: [
					{ name: 'aAA_1', value: 'req' },
					{ name: 'ext:cAA_1', value: 'qualified' },
				],
			},
			expectThrow: true,
		},
		'full-object attr with prefixed name matching its namespace → allowed (canonical round-trip)': {
			sourceXml: /* xml */ `
				<Root ${nsExt}>
					<A ${customId}="a1" aA="parent" />
				</Root>
			`,
			parentRef: { tagName: 'A', id: 'a1' },
			childPayload: {
				tagName: 'AA_1',
				attributes: [
					{ name: 'aAA_1', value: 'req' },
					{ name: 'ext:cAA_1', value: 'qualified', namespace: DIALECTE_TEST_NAMESPACES.ext },
				],
			},
			expectedQueries: [
				'//default:A/default:AA_1[@aAA_1="req"]',
				'//default:A/default:AA_1[@ext:cAA_1="qualified"]',
			],
		},
		'full-object attr with prefixed name conflicting with its namespace → throws loudly': {
			sourceXml: /* xml */ `
				<Root ${nsExt}>
					<A ${customId}="a1" aA="parent" />
				</Root>
			`,
			parentRef: { tagName: 'A', id: 'a1' },
			childPayload: {
				tagName: 'AA_1',
				attributes: [
					{ name: 'aAA_1', value: 'req' },
					{ name: 'ext:cAA_1', value: 'qualified', namespace: DIALECTE_TEST_NAMESPACES.dev },
				],
			},
			expectThrow: true,
		},
		'full-object attr with a registered namespace key string → stored as prefixed': {
			sourceXml: /* xml */ `
				<Root ${nsExt}>
					<A ${customId}="a1" aA="parent" />
				</Root>
			`,
			parentRef: { tagName: 'A', id: 'a1' },
			childPayload: {
				tagName: 'AA_1',
				attributes: [
					{ name: 'aAA_1', value: 'req' },
					{ name: 'cAA_1', value: 'qualified', namespace: 'ext' },
				],
			},
			expectedQueries: [
				'//default:A/default:AA_1[@aAA_1="req"]',
				'//default:A/default:AA_1[@ext:cAA_1="qualified"]',
			],
		},
		'full-object attr with an unknown namespace key string → throws loudly': {
			sourceXml: /* xml */ `
				<Root ${nsExt}>
					<A ${customId}="a1" aA="parent" />
				</Root>
			`,
			parentRef: { tagName: 'A', id: 'a1' },
			childPayload: {
				tagName: 'AA_1',
				attributes: [
					{ name: 'aAA_1', value: 'req' },
					{ name: 'cAA_1', value: 'qualified', namespace: 'nope' },
				],
			},
			expectThrow: true,
		},
		'value object with a namespaced attribute under its stored name → stored in that namespace': {
			sourceXml: /* xml */ `
				<Root ${nsExt}>
					<A ${customId}="a1" aA="parent" />
				</Root>
			`,
			parentRef: { tagName: 'A', id: 'a1' },
			childPayload: { tagName: 'AA_1', attributes: { aAA_1: 'req', 'ext:cAA_1': 'qualified' } },
			expectedQueries: [
				'//default:A/default:AA_1[@aAA_1="req"]',
				'//default:A/default:AA_1[@ext:cAA_1="qualified"]',
			],
		},
		'value object with a prefix no namespace of the dialecte has → throws loudly': {
			sourceXml: /* xml */ `
				<Root ${nsExt}>
					<A ${customId}="a1" aA="parent" />
				</Root>
			`,
			parentRef: { tagName: 'A', id: 'a1' },
			// what untyped code could pass: the types refuse the key
			childPayload: {
				tagName: 'AA_1',
				attributes: { aAA_1: 'req', 'nope:cAA_1': 'x' } as { aAA_1: string },
			},
			expectThrow: true,
		},
		'addChild with a fixed attribute set to a wrong value → throws': {
			sourceXml: /* xml */ `
				<Root ${ns}>
					<C ${customId}="c1" />
				</Root>
			`,
			parentRef: { tagName: 'C', id: 'c1' },
			childPayload: { tagName: 'CC_1', attributes: { aCC_1: 'wrong' } },
			expectThrow: true,
		},
		'addChild with a fixed attribute set to its fixed value → allowed': {
			sourceXml: /* xml */ `
				<Root ${ns}>
					<C ${customId}="c1" />
				</Root>
			`,
			parentRef: { tagName: 'C', id: 'c1' },
			childPayload: { tagName: 'CC_1', attributes: { aCC_1: 'fixed_val' } },
			expectedQueries: ['//default:C/default:CC_1[@aCC_1="fixed_val"]'],
		},
	}

	async function act({
		source,
		testCase,
	}: ActParams<TestDialecteConfig, TestCase>): Promise<ActResult> {
		const transaction = source.transaction(async (tx) => {
			await tx.addChild(testCase.parentRef, testCase.childPayload)
		})
		if (testCase.expectThrow) {
			await expect(transaction).rejects.toThrow()
		} else {
			await transaction
		}
		return {}
	}

	runTestCases.withExport({ testCases, act })
})

describe('stageAddChild — an empty attribute value', () => {
	const ns = `${XMLNS_DEFAULT_NAMESPACE} ${XMLNS_DEV_NAMESPACE}`
	const customId = CUSTOM_RECORD_ID_ATTRIBUTE

	type TestCase = BaseXmlTestCase & {
		parentRef: Ref<TestDialecteConfig, 'BB_1'>
		childPayload: AddChildParams<TestDialecteConfig, 'BB_1', 'BBB_1'>
		name: string
		/** the attribute as stored on the new child (`defaults: 'none'`) */
		expectedStored: { value: string }
		/** `getAttribute` with its default view, on the new child */
		expectedRead: string
	}

	const testCases: TestCases<TestCase> = {
		'empty on an attribute with a default → stored empty, read empty (not the default), exported empty':
			{
				sourceXml: /* xml */ `
					<Root ${ns}>
						<B aB="b">
							<BB_1 ${customId}="bb1" aBB_1="bb" />
						</B>
					</Root>
				`,
				parentRef: { tagName: 'BB_1', id: 'bb1' },
				childPayload: {
					tagName: 'BBB_1',
					id: '0-0-0-0-1',
					attributes: { aBBB_1: 'x', bBBB_1: '' },
				},
				name: 'bBBB_1',
				expectedStored: { value: '' },
				expectedRead: '',
				expectedQueries: ['//default:BB_1/default:BBB_1[@aBBB_1="x"][@bBBB_1=""]'],
			},
	}

	async function act({
		source,
		testCase,
	}: ActParams<TestDialecteConfig, TestCase>): Promise<ActResult> {
		const { name } = testCase
		const childRef = { tagName: 'BBB_1', id: '0-0-0-0-1' } as const
		await source.transaction(async (tx) => {
			await tx.addChild(testCase.parentRef, testCase.childPayload)
		})
		const stored = await source.query.getAttribute(childRef, {
			name: name as 'bBBB_1',
			defaults: 'none',
			fullObject: true,
		})
		expect(stored).toMatchObject(testCase.expectedStored)
		const read = await source.query.getAttribute(childRef, { name: name as 'bBBB_1' })
		expect(read).toBe(testCase.expectedRead)
		return {}
	}

	runTestCases.withExport({ testCases, act })
})

describe('stageAddChild — an empty value on a fixed attribute', () => {
	const ns = `${XMLNS_DEFAULT_NAMESPACE} ${XMLNS_DEV_NAMESPACE}`
	const customId = CUSTOM_RECORD_ID_ATTRIBUTE

	type TestCase = BaseXmlTestCase & {
		parentRef: Ref<TestDialecteConfig, 'C'>
		childPayload: AddChildParams<TestDialecteConfig, 'C', 'CC_1'>
	}

	const testCases: TestCases<TestCase> = {
		'empty on an attribute fixed to a non-empty value → FIXED_VALUE_VIOLATION, nothing created': {
			sourceXml: /* xml */ `
				<Root ${ns}>
					<C ${customId}="c1" />
				</Root>
			`,
			parentRef: { tagName: 'C', id: 'c1' },
			// what untyped code could pass: the types only admit the fixed value
			childPayload: {
				tagName: 'CC_1',
				attributes: { aCC_1: '' } as unknown as { aCC_1: 'fixed_val' },
			},
			unexpectedQueries: ['//default:CC_1'],
		},
	}

	async function act({
		source,
		testCase,
	}: ActParams<TestDialecteConfig, TestCase>): Promise<ActResult> {
		const written = source.transaction(async (tx) => {
			await tx.addChild(testCase.parentRef, testCase.childPayload)
		})
		await expect(written).rejects.toMatchObject({ cause: { key: 'FIXED_VALUE_VIOLATION' } })
		return {}
	}

	runTestCases.withExport({ testCases, act })
})
