import {provideZoneChangeDetection} from '@angular/core';
import {bootstrapApplication} from '@angular/platform-browser';
import {RootComponent} from '@src/Components/Root/RootComponent';
import {AppStorage} from '@src/Model/Storage/AppStorage';
import {createAppStorage} from '@src/Model/Storage/SharedAppStorage';
import {config} from './config';

// Old hashbang links (/#!/1.0/production?share=…): the fragment never reaches the router, so it becomes the real path before the legacy matcher sees it.
if (window.location.hash.startsWith('#!/')) {
	window.history.replaceState(null, '', window.location.hash.substring(2));
}

async function start(): Promise<void>
{
	const storage = await createAppStorage();
	await bootstrapApplication(RootComponent, {
		...config,
		providers: [
			provideZoneChangeDetection(),
			{provide: AppStorage, useValue: storage},
			...config.providers,
		],
	});
}

void start().catch(err => {
	console.error(err);
	// index.html listens for this and replaces the blank page with an error screen.
	document.dispatchEvent(new CustomEvent('sftools:boot-failed', {detail: err}));
});
