import { expect, test } from '@playwright/test';

test('searches blog post titles and bodies by relevance', async ({ page }) => {
	await page.goto('/blog/');

	const searchInput = page.getByRole('searchbox', { name: 'Search posts' });
	await searchInput.fill('astro');
	await searchInput.press('Enter');

	const visibleTitles = page.locator('[data-post-list] > li:visible .title');
	await expect(visibleTitles).not.toHaveCount(0);
	await expect(page.locator('#search-status')).toBeHidden();
	await expect(page.locator('#selected-topic')).toHaveText('Search results for "astro"');
	await expect(visibleTitles.first()).toHaveText('Using MDX');
});

test('shows a message when a search has no matches', async ({ page }) => {
	await page.goto('/blog/');

	await page.getByRole('searchbox', { name: 'Search posts' }).fill('unfindable-keyword');
	await page.getByRole('searchbox', { name: 'Search posts' }).press('Enter');

	await expect(page.locator('#search-status')).toBeVisible();
	await expect(page.locator('#search-status')).toHaveText('No results found');
	await expect(page.locator('[data-post-list] > li:visible')).toHaveCount(0);
});
