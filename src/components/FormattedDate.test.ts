import { describe, expect, it } from 'vitest';

describe('date display', () => {
	it('formats the date used by the time element', () => {
		const date = new Date('2024-01-15T12:00:00.000Z');

		expect(date.toISOString()).toBe('2024-01-15T12:00:00.000Z');
		expect(
			date.toLocaleDateString('en-us', {
				year: 'numeric',
				month: 'short',
				day: 'numeric',
			}),
		).toBe('Jan 15, 2024');
	});
});



