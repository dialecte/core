import { CUSTOM_RECORD_ID_ATTRIBUTE } from '@/helpers'
import { XMLNS_DEFAULT_NAMESPACE, XMLNS_DEV_NAMESPACE, XMLNS_EXT_NAMESPACE } from '@/test'

export const ns = `${XMLNS_DEFAULT_NAMESPACE} ${XMLNS_DEV_NAMESPACE} ${XMLNS_EXT_NAMESPACE}`
export const customId = CUSTOM_RECORD_ID_ATTRIBUTE

/** A parent for each child the cases edit. */
export const SOURCE_XML = /* xml */ `
	<Root ${ns}>
		<A ${customId}="a1" aA="X">
			<AA_1 ${customId}="aa1" aAA_1="n">
				<AAA_1 ${customId}="aaa1" aAAA_1="abc" />
			</AA_1>
		</A>
		<B ${customId}="b1" aB="b">
			<BB_1 ${customId}="bb1" aBB_1="b">
				<BBB_1 ${customId}="bbb1" aBBB_1="b" />
			</BB_1>
		</B>
		<C ${customId}="c1" aC="c">
			<CC_2 ${customId}="cc2" aCC_2="c">
				<CCC_1 ${customId}="ccc1" aCCC_1="c" />
			</CC_2>
		</C>
		<D ${customId}="d1" aD="d">
			<DD_2 ${customId}="dd2" aDD_2="p" />
		</D>
	</Root>
`
