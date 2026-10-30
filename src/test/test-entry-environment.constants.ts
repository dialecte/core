/**
 * The XML APIs only a browser page has. The test entry parses, serializes and queries XML with libxml2 (its XML
 * seam) instead, so its assertions read XML the same way in node and in a browser. A bare name is the browser's
 * global; a name read through a namespace import (`library.DOMParser`) is a library's, not the page's.
 */
export const BROWSER_ONLY_XML_APIS = [
	{ name: 'DOMParser', pattern: /(?<![.\w$])DOMParser\b/, sample: 'new DOMParser()' },
	{ name: 'XMLSerializer', pattern: /(?<![.\w$])XMLSerializer\b/, sample: 'new XMLSerializer()' },
	{ name: 'XPathResult', pattern: /(?<![.\w$])XPathResult\b/, sample: 'XPathResult.ANY_TYPE' },
	{ name: 'document.evaluate', pattern: /\.evaluate\(/, sample: 'xmlDocument.evaluate(xpath)' },
	{ name: 'outerHTML', pattern: /\.outerHTML\b/, sample: 'element.outerHTML' },
] as const
