import { readFileSync, writeFileSync } from 'fs'

// TYPES
import type { AnyRawRecord } from '@/types'

// Read the JSON file
const data = JSON.parse(readFileSync('ssd.json', 'utf8')) as AnyRawRecord[]

// Group by tagName
type GroupedRecords = Record<string, AnyRawRecord[]>

const grouped: GroupedRecords = {}

for (const record of data) {
	const tag = record.tagName
	if (!grouped[tag]) {
		grouped[tag] = []
	}
	grouped[tag].push(record)
}

// Sort keys alphabetically
const sorted: GroupedRecords = {}
Object.keys(grouped)
	.sort()
	.forEach((key) => {
		sorted[key] = grouped[key]
	})

// Write back with pretty formatting (tabs for consistency with project style)
writeFileSync('entrypoint-ssd.json', JSON.stringify(sorted, null, '\t'))

console.log('✓ JSON sorted by tagName')
console.log('  Found', Object.keys(sorted).length, 'unique tag names')
console.log('  Keys:', Object.keys(sorted).join(', '))
