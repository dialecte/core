import type * as sax from 'sax'

/**
 * The options core's XML reader builds sax with. sax's own trim and normalize are off: they use JavaScript's
 * whitespace (a no-break space, a byte order mark...), core trims and collapses each run of text with XML's.
 */
export const SAX_PARSER_OPTIONS: sax.SAXOptions = {
	lowercase: false, // Preserve case
	trim: false,
	normalize: false,
	position: false, // Don't track position (performance boost)
	xmlns: true, // Enable namespace handling
}
