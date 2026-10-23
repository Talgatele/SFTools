import '@angular/compiler';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {deflateSync} from 'node:zlib';
import {JSDOM} from 'jsdom';
import {HttpErrorResponse, HttpRequest, HttpResponse} from '@angular/common/http';
import {lastValueFrom, of, throwError} from 'rxjs';
import {TestScheduler} from 'rxjs/testing';
import {SftContainer} from '../src/app/Model/PlanFiles/SftContainer.ts';
import {PlanFileReader} from '../src/app/Model/PlanFiles/PlanFileReader.ts';
import {SftFileParser} from '../src/app/Model/OldTools/SftFileParser.ts';
import {RetryInterceptor} from '../src/app/Model/API/RetryInterceptor.ts';
import {env} from '../src/env/env.prod.ts';

// DOMPurify must see a DOM when its module initializes, as it does in the browser.
const dom = new JSDOM('', {url: 'https://satisfactory.bitstacker.dev/'});
globalThis.window = dom.window;
globalThis.document = dom.window.document;
const {HelpMarkdownRenderer} = await import('../src/app/Model/Help/HelpMarkdownRenderer.ts');
const renderer = new HelpMarkdownRenderer(
	{assetUrl: path => `https://api.new.satisfactorytools.com/${path}`},
	{label: () => 'Ctrl+K'},
	{summary: () => null},
);
const links = {
	articleHref: (slug, anchor) => `/help/${slug}#${anchor}`,
	sectionHref: anchor => `/help/test#${anchor}`,
	panelHref: id => `/game/planner?panel=${id}`,
	panelLabel: () => 'Recipes',
};
const render = (markdown, resolver = links) => {
	const container = document.createElement('div');
	container.innerHTML = renderer.render(markdown, resolver);
	return container;
};

test('help rejects raw HTML, script URLs and attribute injection', () => {
	for (const markdown of [
		'<img src=x onerror=alert(1)><script>alert(1)</script>',
		'[click](javascript:alert%281%29)',
		'[click](javascript&colon;alert%281%29)',
		'![x](data:image/svg+xml;base64,PHN2ZyBvbmxvYWQ9YWxlcnQoMSk+)',
		'![x](https://example.com/image.png "x\" onerror=\"alert(1)")',
	]) {
		const content = render(markdown);
		assert.equal(content.querySelector('script, iframe, object, embed, [onerror], [onload]'), null);
		for (const element of content.querySelectorAll('[href], [src]')) {
			assert.doesNotMatch(element.getAttribute('href') ?? element.getAttribute('src'), /^\s*(javascript|data):/i);
		}
	}
});

test('final help sanitizer rejects unsafe URLs even from a link resolver', () => {
	const content = render('## Heading', {...links, sectionHref: () => 'javascript:alert(1)'});
	assert.equal(content.querySelector('.help-anchor').hasAttribute('href'), false);
});

test('help keeps navigation, accessible images, tables, hotkeys and SVG icons', () => {
	const content = render('## Heading\n\n[Article](help:guide#section) [Panel](panel:recipes) [External](https://example.com)\n\n`hotkey:search`\n\n![Alt](data/help/image.png "Caption")\n\n| A | B |\n|---|---|\n| 1 | 2 |');
	assert.equal(content.querySelector('h2').id, 'heading');
	assert.equal(content.querySelector('[data-help-article]').dataset.helpArticle, 'guide');
	assert.equal(content.querySelector('[data-help-panel]').dataset.helpPanel, 'recipes');
	assert.equal(content.querySelector('[target="_blank"]').getAttribute('rel'), 'noopener noreferrer');
	assert.ok(content.querySelector('svg path'));
	assert.equal(content.querySelector('kbd').textContent, 'Ctrl+K');
	assert.equal(content.querySelector('img').getAttribute('tabindex'), '0');
	assert.equal(content.querySelector('figcaption').textContent, 'Caption');
	assert.ok(content.querySelector('table.table'));
});

test('protocol-relative help links are external and malformed email escapes do not break rendering', () => {
	const content = render('[External](//example.com/path) [Email](mailto:%zz)');
	assert.equal(content.querySelector('[data-help-route]'), null);
	assert.equal(content.querySelector('a').target, '_blank');
	assert.equal(content.querySelectorAll('a').length, 2);
});

test('plan container round-trips Unicode for both supported formats', async () => {
	for (const format of [SftContainer.oldToolsFormat, SftContainer.planFormat]) {
		const json = JSON.stringify({name: 'Factory 🏭 — výroba', data: 'iron'.repeat(10000)});
		const content = await SftContainer.encode(format, json, ['Example export']);
		assert.equal(SftContainer.format(content), format);
		assert.equal(await SftContainer.decode(SftContainer.payload(content)), json);
	}
});

test('plan imports stop a small compressed payload before it expands past the limit', async () => {
	const payload = '1' + deflateSync(Buffer.alloc(SftContainer.maxDecodedBytes + 1, 65)).toString('base64');
	assert.ok(payload.length < 100000);
	await assert.rejects(SftContainer.decode(payload), /64 MiB/);
});

test('plan imports reject oversized input before base64 decoding', async () => {
	const input = '1'.repeat(SftContainer.maxFileCharacters + 1);
	assert.throws(() => SftContainer.payload(input), /32 MiB/);
	await assert.rejects(SftContainer.decode(input), /32 MiB/);
});

test('null JSON exports fail with a useful validation message', async () => {
	const current = await SftContainer.encode('1', 'null', []);
	const legacy = await SftContainer.encode('0', 'null', []);
	await assert.rejects(new PlanFileReader().read(current), /not a plans export/);
	await assert.rejects(new SftFileParser().parse(legacy), /not a production line export/);
});

test('gateway failures never replay a write that may already have committed', async () => {
	for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
		for (const status of [0, 502, 503, 504]) {
			let attempts = 0;
			const interceptor = new RetryInterceptor({retryStarted() { assert.fail('write was retried'); }}, {online: () => true});
			const error = new HttpErrorResponse({status});
			const response = interceptor.intercept(new HttpRequest(method, `${env.apiUrl}/v1/shares`, {}), {
				handle() { attempts++; return throwError(() => error); },
			});
			await assert.rejects(lastValueFrom(response), candidate => candidate === error);
			assert.equal(attempts, 1);
		}
	}
});

test('safe reads still recover from a transient gateway failure', () => {
	const scheduler = new TestScheduler((actual, expected) => assert.deepEqual(actual, expected));
	scheduler.run(({expectObservable}) => {
		let attempts = 0, retries = 0;
		const interceptor = new RetryInterceptor({retryStarted() { retries++; }, retryFinished() { retries--; }}, {online: () => true});
		const success = new HttpResponse({body: {ok: true}});
		const response = interceptor.intercept(new HttpRequest('GET', `${env.apiUrl}/v1/versions`), {
			handle() { return ++attempts === 1 ? throwError(() => new HttpErrorResponse({status: 503})) : of(success); },
		});
		expectObservable(response).toBe('2000ms (a|)', {a: success});
		scheduler.schedule(() => { assert.equal(attempts, 2); assert.equal(retries, 0); }, 2001);
	});
});
