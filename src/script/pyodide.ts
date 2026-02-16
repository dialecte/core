import { readFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

import { loadPyodide, type PyodideInterface } from 'pyodide'

let pyodideInstance: PyodideInterface | null = null

/**
 * Initialize Pyodide singleton with xmlschema package
 */
async function initPyodide(): Promise<PyodideInterface> {
	if (pyodideInstance) {
		return pyodideInstance
	}

	console.log('[pyodide] Loading Pyodide (this may take a minute)...')
	pyodideInstance = await loadPyodide()

	console.log('[pyodide] Installing xmlschema (this may take a minute)...')
	await pyodideInstance.loadPackage('micropip')
	const micropip = pyodideInstance.pyimport('micropip')
	await micropip.install('xmlschema')

	console.log('[pyodide] Ready')
	return pyodideInstance
}

/**
 * Parse XSD file using Python xmlschema via Pyodide
 */
export async function parseXsdWithPython(params: {
	xsdPath: string
	outputPath: string
}): Promise<Record<string, any>> {
	const { xsdPath, outputPath } = params

	const pyodide = await initPyodide()

	// Read Python script
	const __filename = fileURLToPath(import.meta.url)
	const __dirname = dirname(__filename)
	const pythonScriptPath = resolve(__dirname, 'generate_definition.py')
	let pythonScript = readFileSync(pythonScriptPath, 'utf-8')

	// Extract from __future__ imports (must be at start of file)
	const futureImports: string[] = []
	pythonScript = pythonScript.replace(/^from __future__ import .*$/gm, (match) => {
		futureImports.push(match)
		return ''
	})

	// Read XSD files into Pyodide virtual filesystem
	const xsdContent = readFileSync(xsdPath, 'utf-8')
	const xsdDir = dirname(xsdPath)
	const xsdFilename = xsdPath.split('/').pop() || 'schema.xsd'

	// Mount XSD directory to allow imports/includes
	pyodide.FS.mkdirTree('/xsd')
	pyodide.FS.writeFile(`/xsd/${xsdFilename}`, xsdContent)

	// Copy all XSD files from directory (for imports/includes)
	try {
		const fs = await import('fs/promises')
		const files = await fs.readdir(xsdDir)
		for (const file of files) {
			if (file.endsWith('.xsd')) {
				const content = await fs.readFile(resolve(xsdDir, file), 'utf-8')
				pyodide.FS.writeFile(`/xsd/${file}`, content)
			}
		}
	} catch (err) {
		console.warn('[pyodide] Could not copy XSD directory:', err)
	}

	// Create wrapper Python code - __future__ imports MUST be first
	const wrapperCode = `${futureImports.join('\n')}
import json
from pathlib import Path
from decimal import Decimal

# Inject the script functions (with __future__ imports already stripped)
${pythonScript.replace(/if __name__ == '__main__':[\s\S]*$/, '')}

# Build IR and canonical model
import xmlschema
schema = xmlschema.XMLSchema11('/xsd/${xsdFilename}')
ir = build_ir(schema)
canonical = build_canonical_from_ir(ir)

# Custom JSON encoder for Decimal (same as in the script)
def _default(o):
    if isinstance(o, Decimal):
        return float(o) if o % 1 else int(o)
    raise TypeError(f'Object of type {o.__class__.__name__} is not JSON serializable')

# Return canonical model as JSON string with Decimal handling
json.dumps(canonical, ensure_ascii=False, default=_default)
`

	console.log('[pyodide] Parsing XSD...')
	const resultJson = await pyodide.runPythonAsync(wrapperCode)

	// Parse JSON string
	const jsResult = JSON.parse(resultJson)

	// Write to actual filesystem
	const fs = await import('fs/promises')
	await fs.writeFile(outputPath, JSON.stringify(jsResult, null, 2))

	console.log('[pyodide] Wrote', outputPath)

	return jsResult
}

/**
 * Clean up Pyodide instance (optional)
 */
export function cleanupPyodide() {
	pyodideInstance = null
}
