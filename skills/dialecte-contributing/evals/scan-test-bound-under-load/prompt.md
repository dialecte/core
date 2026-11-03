---
tags: [dialecte]
max_turns: 20
timeout_seconds: 600
allowed_tools: [Read, Glob, Grep, Skill, Write]
---

You are the test review of step 1 of a lot of @dialecte/core. The step's one new test, `src/test/dependencies.test.ts`, reads:

```ts
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

const SOURCE_ROOT = join(import.meta.dirname, '..')

function listSourceFiles(folder: string): string[] {
	return readdirSync(folder, { withFileTypes: true, recursive: true })
		.filter((entry) => entry.isFile() && entry.name.endsWith('.ts'))
		.map((entry) => join(entry.parentPath, entry.name))
}

describe('production dependencies', () => {
	it('no production file imports from a test folder', () => {
		const offenders = listSourceFiles(SOURCE_ROOT)
			.filter((file) => !file.endsWith('.test.ts'))
			.filter((file) => /from '[^']*\/test\/[^']*'/.test(readFileSync(file, 'utf8')))
		expect(offenders).toEqual([])
	})
})
```

The spec of the step: "no production file of src/ imports from a test folder". `tdd red` recorded it red on the one offender the lot then removes. The test runs in Node; core's src/ holds about 900 files. Do NOT run anything: write ./out/TEST-REVIEW.md, your test-review verdict with its findings.
