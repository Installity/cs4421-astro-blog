import { expect, test } from '@playwright/test';

for (const viewport of [{ width: 1280, height: 900 }, { width: 390, height: 844 }]) {
	test.describe(`${viewport.width}px homepage`, () => {
		test.use({ viewport });

		test('shows the latest articles with working article and listing links', async ({ page }) => {
			await page.goto('/');
			const section = page.getByRole('region', { name: 'Recent posts' });
			const articles = section.getByRole('article');
			await expect(articles).toHaveCount(3);
			await expect(articles.getByRole('heading')).toHaveText([
				'Markdown Style Guide', 'Using MDX', 'Third post',
			]);
			await expect(articles.locator('time')).toHaveText(['Jun 19, 2024', 'Jun 1, 2024', 'Jul 22, 2022']);
			await expect(articles.nth(0)).toContainText('Here is a sample of some basic Markdown syntax');
			await expect(articles.nth(1)).toContainText('Lorem ipsum dolor sit amet');
			await expect(articles.nth(2)).toContainText('Lorem ipsum dolor sit amet');

			expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
			await expect(section).toBeVisible();
			await page.screenshot({ path: `test-results/homepage-${viewport.width}-${test.info().project.name}.png`, fullPage: true });

			for (const [title, slug] of [
				['Markdown Style Guide', 'markdown-style-guide'],
				['Using MDX', 'using-mdx'],
				['Third post', 'third-post'],
			]) {
				await section.getByRole('link', { name: title, exact: true }).click();
				await expect(page).toHaveURL(new RegExp(`/blog/${slug}/$`));
				await expect(page.getByRole('heading', { name: title, level: 1 })).toBeVisible();
				await page.goto('/');
			}

			await section.getByRole('link', { name: 'View all posts' }).click();
			await expect(page).toHaveURL(/\/blog\/$/);
			await expect(page.getByRole('combobox', { name: 'Filter by topic' })).toBeVisible();
		});
	});
}
