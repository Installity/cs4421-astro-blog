import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { describe, expect, it } from 'vitest';
import RelatedArticles from './RelatedArticles.astro';

const post = (id: string, topics: string[], pubDate = '2024-01-01') => ({
	id,
	data: {
		title: `Title ${id}`,
		description: `Description ${id}`,
		pubDate: new Date(pubDate),
		author: { collection: 'authors' as const, id: 'andrew' },
		topics,
	},
});

const currentPost = post('current', ['Astro', 'Markdown']);
const render = async (posts: ReturnType<typeof post>[], current = currentPost) => {
	const container = await AstroContainer.create();
	return container.renderToString(RelatedArticles, { props: { currentPost: current, posts } });
};

describe('related articles', () => {
	it('excludes the current article and unrelated posts', async () => {
		const html = await render([currentPost, post('match', ['Astro']), post('unrelated', ['CSS'])]);
		expect(html.match(/Title [a-z]+/g)).toEqual(['Title match']);
		expect(html).toContain('Related articles');
	});

	it('ranks distinct shared topics before publication date and limits results to three', async () => {
		const posts = [
			post('newest', ['Astro'], '2025-01-01'),
			post('strongest', ['Astro', 'Markdown'], '2022-01-01'),
			post('oldest', ['Markdown'], '2023-01-01'),
			post('middle', ['Astro'], '2024-01-01'),
		];
		const html = await render(posts);
		expect(html.match(/Title [a-z]+/g)).toEqual(['Title strongest', 'Title newest', 'Title middle']);
		expect(posts.map(({ id }) => id)).toEqual(['newest', 'strongest', 'oldest', 'middle']);
	});

	it('does not inflate the score for duplicate topics', async () => {
		const html = await render([
			post('duplicates', ['Astro', 'Astro', 'Astro'], '2025-01-01'),
			post('strongest', ['Astro', 'Markdown'], '2022-01-01'),
		], post('current', ['Astro', 'Astro', 'Markdown']));
		expect(html.match(/Title [a-z]+/g)).toEqual(['Title strongest', 'Title duplicates']);
	});

	it.each([1, 2, 3])('renders all %i available matches with correct links and metadata', async (count) => {
		const posts = Array.from({ length: count }, (_, i) => post(`nested/post-${i}`, ['Astro']));
		const html = await render(posts);
		expect(html.match(/<li\b/g)).toHaveLength(count);
		for (const entry of posts) {
			expect(html).toContain(`href="/blog/${entry.id}/"`);
			expect(html).toContain(entry.data.description);
			expect(html).toContain(`datetime="${entry.data.pubDate.toISOString()}"`);
		}
	});

	it.each([
		{ posts: [] },
		{ posts: [currentPost] },
		{ posts: [post('unrelated', ['CSS']), post('untagged', [])] },
	])('omits the entire section when there are no matches ($posts)', async ({ posts }) => {
		const html = await render(posts);
		expect(html).not.toContain('<section');
		expect(html).not.toContain('Related articles');
		expect(html).not.toContain('<li');
	});

	it('omits the section when the current article has no topics', async () => {
		expect(await render([post('other', ['Astro'])], post('current', []))).not.toContain('<section');
	});
});
