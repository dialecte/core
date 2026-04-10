import { defineConfig } from 'vitepress'
import llmstxt from 'vitepress-plugin-llms'

// https://vitepress.dev/reference/site-config
export default defineConfig({
	vite: {
		plugins: [llmstxt()],
	},
	srcDir: 'doc',
	base: '/core/',

	title: 'Dialecte',
	description: 'XML based DSL builder',
	head: [['link', { rel: 'icon', href: '/core/logo.svg' }]],
	themeConfig: {
		// https://vitepress.dev/reference/default-theme-config
		logo: '/logo.svg',

		search: {
			provider: 'local',
		},

		nav: [
			{ text: 'Home', link: '/' },
			{ text: 'Guide', link: '/guide/introduction/getting-started' },
			{ text: 'Api', link: '/api' },
			{
				text: 'LLMs',
				items: [
					{ text: 'llms.txt', link: '/llms.txt', target: '_blank' },
					{ text: 'llms-full.txt', link: '/llms-full.txt', target: '_blank' },
				],
			},
		],

		sidebar: {
			'/guide/': [
				{
					text: 'Getting Started',
					items: [
						{ text: 'Introduction', link: '/guide/introduction/what-is-dialecte' },
						{ text: 'Quick Start', link: '/guide/introduction/getting-started' },
					],
				},
				{
					text: 'Development',
					items: [
						{ text: 'State & Errors', link: '/guide/development/state-and-errors' },
						{ text: 'Testing', link: '/guide/development/testing' },
					],
				},
				{
					text: 'Extensions',
					items: [{ text: 'Writing Extensions', link: '/guide/extensions/' }],
				},
			],
			'/api/': [
				{
					text: 'Introduction',
					items: [{ text: 'Overview', link: '/api' }],
				},
				{
					text: 'API Reference',
					items: [
						{ text: 'Document', link: '/api/document' },
						{ text: 'Query', link: '/api/query' },
						{ text: 'Transaction', link: '/api/transaction' },
						{ text: 'Hooks', link: '/api/hooks' },
					],
				},
			],
			'/io/': [
				{
					text: 'IO',
					items: [
						{ text: 'Overview', link: '/io/' },
						{ text: 'Reference', link: '/io/io' },
						{ text: 'Hooks', link: '/io/hooks' },
					],
				},
			],
		},

		socialLinks: [{ icon: 'github', link: 'https://github.com/dialecte/core' }],
	},
})
