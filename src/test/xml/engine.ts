// Importing engine-console puts its forwarders on the console, before the engine loads and binds it: this import
// comes first (relative imports sort before packages), and the restore it brings runs once the engine is loaded.
import { restoreConsoleAfterEngineLoad } from './engine-console'

import {
	ParseOption,
	XmlAttribute,
	XmlBufferInputProvider,
	XmlCData,
	XmlComment,
	XmlDocument,
	XmlElement,
	XmlParseError,
	XmlText,
	XmlValidateError,
	XsdValidator,
	xmlRegisterInputProvider,
} from 'libxml2-wasm'

// The engine has bound its console writers while loading: the console is the caller's own again.
restoreConsoleAfterEngineLoad()

export {
	ParseOption,
	XmlAttribute,
	XmlBufferInputProvider,
	XmlCData,
	XmlComment,
	XmlDocument,
	XmlElement,
	XmlParseError,
	XmlText,
	XmlValidateError,
	XsdValidator,
	xmlRegisterInputProvider,
}
