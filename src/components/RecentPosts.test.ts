import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { describe, expect, it } from 'vitest';
import RecentPosts from './RecentPosts.astro';

const post = (id: string, pubDate: string) => ({
	id,
	data: {
		title: `Title ${id}`,
		description: `Description ${id}`,
		pubDate: new Date(pubDate),
		author: { collection: 'authors' as const, id: 'andrew' },
		topics: [],
	},
});

const posts = [
	post('oldest', '2022-01-01'),
	post('newest', '2025-01-15'),
	post('third', '2023-01-01'),
	post('second', '2024-01-01'),
];

describe('recent posts', () => {
	it('renders only the three newest posts in descending publication order', async () => {
		const container = await AstroContainer.create();
		const html = await container.renderToString(RecentPosts, { props: { posts } });

		expect(html.match(/Title [a-z]+/g)).toEqual(['Title newest', 'Title second', 'Title third']);
		expect(html).not.toContain('oldest');
		for (const entry of posts.slice(1)) {
			expect(html).toContain(entry.data.description);
			expect(html).toContain(`href="/blog/${entry.id}/"`);
			expect(html).toContain(`datetime="${entry.data.pubDate.toISOString()}"`);
		}
		expect(html).toContain('Jan 15, 2025');
		expect(html).toMatch(/<a href="\/blog\/"[^>]*>View all posts ↗<\/a>/);
	});

	it.each([0, 1, 2, 3])('renders %i available posts without placeholders', async (count) => {
		const container = await AstroContainer.create();
		const html = await container.renderToString(RecentPosts, { props: { posts: posts.slice(0, count) } });

		expect(html.match(/<li\b/g) ?? []).toHaveLength(count);
		expect(html.match(/<article\b/g) ?? []).toHaveLength(count);
	});
});
