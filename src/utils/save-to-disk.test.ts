import { saveToDisk } from './save-to-disk'

import { describe, it, expect, vi, afterEach } from 'vitest'

import { runTestCases } from '@/test'

import type { BaseTestCase } from '@/test'

// ── Helpers ──────────────────────────────────────────────────────────────────

type MockWritable = { write: ReturnType<typeof vi.fn>; close: ReturnType<typeof vi.fn> }

function stubPicker(handle: { createWritable: () => Promise<MockWritable> } | (() => never)) {
	const picker = typeof handle === 'function' ? vi.fn(handle) : vi.fn().mockResolvedValue(handle)
	;(window as any).showSaveFilePicker = picker
	return picker
}

function makeWritable(): MockWritable {
	return {
		write: vi.fn().mockResolvedValue(undefined),
		close: vi.fn().mockResolvedValue(undefined),
	}
}

afterEach(() => {
	delete (window as any).showSaveFilePicker
	vi.restoreAllMocks()
})

// ── Tests ────────────────────────────────────────────────────────────────────

describe('saveToDisk', () => {
	it('uses showSaveFilePicker when available, writes data, closes writable', async () => {
		const writable = makeWritable()
		const picker = stubPicker({ createWritable: () => Promise.resolve(writable) })

		const data = new Blob(['hello'])
		await saveToDisk({ data, filename: 'a.txt' })

		expect(picker).toHaveBeenCalledWith({ suggestedName: 'a.txt' })
		expect(writable.write).toHaveBeenCalledWith(data)
		expect(writable.close).toHaveBeenCalled()
	})

	it('forwards pickerType as types[0] when provided', async () => {
		const writable = makeWritable()
		const picker = stubPicker({ createWritable: () => Promise.resolve(writable) })

		const pickerType = { description: 'PDF Files', accept: { 'application/pdf': ['.pdf'] } }
		await saveToDisk({ data: new Blob(['x']), filename: 'a.pdf', pickerType })

		expect(picker).toHaveBeenCalledWith({ suggestedName: 'a.pdf', types: [pickerType] })
	})

	it('swallows AbortError silently (user cancellation)', async () => {
		const error = new Error('cancelled')
		error.name = 'AbortError'
		stubPicker(() => {
			throw error
		})
		const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

		await expect(saveToDisk({ data: new Blob(['x']), filename: 'a.txt' })).resolves.toBeUndefined()
		expect(consoleError).not.toHaveBeenCalled()
	})

	describe('a picker refused for a lapsed user gesture -> the same Blob downloaded', () => {
		type LapsedCase = BaseTestCase & { errorName: string }
		const testCases: Record<string, LapsedCase> = {
			'SecurityError -> downloaded': { errorName: 'SecurityError' },
			'NotAllowedError -> downloaded': { errorName: 'NotAllowedError' },
		}

		runTestCases.generic(testCases, async (testCase) => {
			stubPicker(() => {
				throw new DOMException('the gesture lapsed', testCase.errorName)
			})
			const click = vi.fn()
			const anchor = document.createElement('a')
			anchor.click = click
			vi.spyOn(document, 'createElement').mockReturnValue(anchor)
			const createObjectURL = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:lapsed')
			vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
			const data = new Blob(['x'])

			await saveToDisk({ data, filename: 'a.txt' })

			expect(createObjectURL).toHaveBeenCalledWith(data)
			expect(anchor.download).toBe('a.txt')
			expect(click).toHaveBeenCalled()
		})
	})

	it('a picker failing otherwise than by a cancel -> the failure thrown', async () => {
		stubPicker(() => {
			throw new Error('boom')
		})

		await expect(saveToDisk({ data: new Blob(['x']), filename: 'a.txt' })).rejects.toThrow('boom')
	})

	it('falls back to anchor download when showSaveFilePicker is unavailable', async () => {
		// Ensure the picker is absent.
		delete (window as any).showSaveFilePicker
		const click = vi.fn()
		const anchor = document.createElement('a')
		anchor.click = click
		const createElement = vi.spyOn(document, 'createElement').mockReturnValue(anchor)
		const createObjectURL = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:mock')
		const revokeObjectURL = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})

		await saveToDisk({ data: new Blob(['x']), filename: 'a.txt' })

		expect(createElement).toHaveBeenCalledWith('a')
		expect(anchor.download).toBe('a.txt')
		expect(anchor.href).toContain('blob:mock')
		expect(click).toHaveBeenCalled()
		expect(createObjectURL).toHaveBeenCalled()
		expect(revokeObjectURL).toHaveBeenCalledWith('blob:mock')
	})
})
