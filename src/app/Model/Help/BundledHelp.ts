import {HelpManifest} from '@src/Model/API/Schema/Help/HelpManifest';

/** Frontend-specific help takes precedence over externally published articles. */
export function withBundledHelp(manifest: HelpManifest | null): HelpManifest
{
	const category = 'production-request';
	const categories = (manifest?.categories ?? []).map(entry => entry.id === category
		? {...entry, articles: [...new Set([...entry.articles, 'tab-request'])]} : entry);
	if (!categories.some(entry => entry.id === category)) {
		categories.push({id: category, name: 'Production request', articles: ['tab-request']});
	}
	return {
		generatedAt: manifest?.generatedAt ?? '2026-10-19',
		categories,
		articles: {
			...manifest?.articles,
			'tab-request': {
				title: 'Request tab',
				summary: 'Choose fixed rates, maximise output, or use Satisfactory mode to balance production by item tier.',
				keywords: ['request', 'rate', 'per minute', 'maximise', 'satisfactory', 'custom', 'space elevator', 'rounding'],
				topics: {'request.production': ''},
				sections: [
					{id: 'fixed-rates', title: 'Fixed rates', level: 2},
					{id: 'maximise', title: 'Maximise', level: 2},
					{id: 'satisfactory-mode', title: 'Satisfactory mode', level: 2},
					{id: 'custom-rates-in-satisfactory-mode', title: 'Custom rates in Satisfactory mode', level: 3},
					{id: 'removing', title: 'Removing', level: 2},
				],
				seeAlso: ['first-plan', 'tab-resources', 'tab-recipes', 'tab-optimisation'],
				category,
				updatedAt: '2026-10-19',
			},
		},
	};
}
