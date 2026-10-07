import { expect, test } from '@playwright/test';

for (const viewport of [{ width: 1280, height: 900 }, { width: 390, height: 844 }]) {
	test.describe(`${viewport.width}px related articles`, () => {
		test.use({ viewport });

		test('shows related articles after the post and opens each correct destination', async ({ page }) => {
			// A cold dev server can reload after optimizing the first MDX request.
			await page.goto('/blog/using-mdx/', { waitUntil: 'networkidle' });
			const section = page.getByRole('region', { name: 'Related articles' });
			await section.scrollIntoViewIfNeeded();
			await expect(section).toBeVisible();
			await expect(section.getByRole('heading', { level: 3 })).toHaveText(['Markdown Style Guide', 'First post']);
			await expect(section.getByRole('link')).toHaveCount(2);
			await expect(section.getByRole('link', { name: 'Using MDX' })).toHaveCount(0);
			expect(await section.evaluate((element) => {
				const author = document.querySelector('.author-bio');
				return !!author && !!(author.compareDocumentPosition(element) & Node.DOCUMENT_POSITION_FOLLOWING);
			})).toBe(true);
			expect(await section.evaluate((element) => element.getBoundingClientRect().right <= window.innerWidth)).toBe(true);
			await page.screenshot({ path: `test-results/related-${viewport.width}-${test.info().project.name}.png` });

			for (const [title, slug] of [['Markdown Style Guide', 'markdown-style-guide'], ['First post', 'first-post']]) {
				await section.getByRole('link', { name: title, exact: true }).click();
				await expect(page).toHaveURL(new RegExp(`/blog/${slug}/$`));
				await expect(page.getByRole('heading', { name: title, level: 1 })).toBeVisible();
				await page.goto('/blog/using-mdx/');
			}
		});

		test('shows a single match without placeholders', async ({ page }) => {
			await page.goto('/blog/third-post/');
			const section = page.getByRole('region', { name: 'Related articles' });
			await expect(section.getByRole('link')).toHaveCount(1);
			await expect(section.getByRole('link')).toHaveText('Second post');
		});
	});
}
