/**
 * A document of core's test dialecte as the export wrote it before it ran in the store - the DOM builder, the
 * serializer and the formatter - kept as their bytes: several namespaces, xsi:type in the default and in another
 * namespace, escaped characters, attributes the schema requires or fixes left to the export, a multi-line text value
 * with CRLF and CR line ends (set by a transaction: an import normalizes whitespace).
 */
export const GOLDEN_SOURCE_XML =
	'<Root xmlns="http://dialecte.dev/XML/DEFAULT" xmlns:dev="http://dialecte.dev/XML/DEV" xmlns:ext="http://dialecte.dev/XML/DEV-EXT" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" root="1" ext:root="2"><A aA="a &amp; b" ext:cA="extended"><AA_1 aAA_1="one"><AAA_1 aAAA_1="x"><AAAA_1 aAAAA_1="leaf" ext:cAAAA_1="e">old</AAAA_1><ext:AAAA_3/></AAA_1></AA_1><ext:AA_3 ext:aAA_3="three"/></A><B aB="b"><BB_1/></B><C aC="c"><CC_1/></C><D aD="d"><DD_1 xsi:type="ext:tDD_1A" aDD_1="s" ext:dDD_1="5"/><DD_2 xsi:type="tDD_2" aDD_2="p"/></D></Root>'

/** The text value the transaction writes on `AAAA_1`. */
export const GOLDEN_LEAF_VALUE = 'line one\r\nline two\rend "quoted" <tag> & more'

/** The formatted file the builder wrote. */
export const GOLDEN_FORMATTED =
	'<?xml version="1.0" encoding="UTF-8"?>\r\n<Root xmlns="http://dialecte.dev/XML/DEFAULT" ext:root="2" root="1" xmlns:ext="http://dialecte.dev/XML/DEV-EXT" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">\r\n    <A aA="a &amp; b" ext:cA="extended">\r\n        <AA_1 aAA_1="one">\r\n            <AAA_1 aAAA_1="x">\r\n                <AAAA_1 aAAAA_1="leaf" ext:cAAAA_1="e">line one\r\nline two\rend "quoted" &lt;tag&gt; &amp; more</AAAA_1>\r\n                <ext:AAAA_3 ext:aAAAA_3=""/>\r\n            </AAA_1>\r\n        </AA_1>\r\n        <ext:AA_3 ext:aAA_3="three"/>\r\n    </A>\r\n    <B aB="b">\r\n        <BB_1 aBB_1=""/>\r\n    </B>\r\n    <C aC="c">\r\n        <CC_1 aCC_1="fixed_val"/>\r\n    </C>\r\n    <D aD="d">\r\n        <DD_1 aDD_1="s" ext:dDD_1="5" xsi:type="ext:tDD_1A"/>\r\n        <DD_2 aDD_2="p" xsi:type="tDD_2"/>\r\n    </D>\r\n</Root>'

/** The compact file the builder wrote (`XMLSerializer` after the declaration). */
export const GOLDEN_COMPACT =
	'<?xml version="1.0" encoding="UTF-8"?><Root xmlns="http://dialecte.dev/XML/DEFAULT" ext:root="2" root="1" xmlns:ext="http://dialecte.dev/XML/DEV-EXT" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><A aA="a &amp; b" ext:cA="extended"><AA_1 aAA_1="one"><AAA_1 aAAA_1="x"><AAAA_1 aAAAA_1="leaf" ext:cAAAA_1="e">line one\r\nline two\rend "quoted" &lt;tag&gt; &amp; more</AAAA_1><ext:AAAA_3 ext:aAAAA_3=""/></AAA_1></AA_1><ext:AA_3 ext:aAA_3="three"/></A><B aB="b"><BB_1 aBB_1=""/></B><C aC="c"><CC_1 aCC_1="fixed_val"/></C><D aD="d"><DD_1 aDD_1="s" ext:dDD_1="5" xsi:type="ext:tDD_1A"/><DD_2 aDD_2="p" xsi:type="tDD_2"/></D></Root>'
