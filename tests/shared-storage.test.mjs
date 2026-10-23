import '@angular/compiler';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {AppStorage} from '../src/app/Model/Storage/AppStorage.ts';
import {SharedAppStorage, createAppStorage} from '../src/app/Model/Storage/SharedAppStorage.ts';
import {mergeLibraryImport} from '../src/app/Model/Storage/LibraryImport.ts';

const key = 'sftools.plans.game-version';
const journalKey = 'sftools.serverLibrary.journal';
const plan = (id, name = id, extras = {}) => ({id, name, folderId: null, parentPlanId: null, graph: null, ...extras});
const store = (plans = [], folders = []) => JSON.stringify({plans, folders});
class MemoryStorage extends AppStorage {
	constructor(entries = {}) { super(); this.values = new Map(Object.entries(entries)); }
	getItem(key) { return this.values.get(key) ?? null; }
	setItem(key, value) { this.values.set(key, value); }
	removeItem(key) { this.values.delete(key); }
	keys(prefix) { return [...this.values.keys()].filter(key => key.startsWith(prefix)); }
}
const json = (body, status = 200) => new Response(JSON.stringify(body), {status, headers: {'Content-Type': 'application/json'}});
function serverFixture(t, entries = {}) {
	const originalFetch = globalThis.fetch, originalWindow = globalThis.window;
	const disposables = [];
	const target = new EventTarget();
	let reloads = 0;
	globalThis.window = Object.assign(target, {location: {hostname: 'satisfactory.bitstacker.dev', reload() { reloads++; }}});
	const server = {entries: structuredClone(entries), instance: 'server-1', writes: [], offline: false, unauthorized: false, beforePut: null};
	globalThis.fetch = async (url, options = {}) => {
		if (server.offline) throw new TypeError('Network unavailable');
		const action = new URL(url, 'https://satisfactory.bitstacker.dev').searchParams.get('action');
		if (action === 'session') return json({authenticated: true, csrf: 'test-csrf'});
		if (server.unauthorized) return json({error: 'Sign in again'}, 401);
		if (options.method === 'PUT') {
			const body = JSON.parse(options.body);
			server.writes.push(body);
			if (server.beforePut) await server.beforePut(body);
			const existing = server.entries[body.key];
			if (body.revision !== (existing?.revision ?? 0)) return json({error: 'Another device changed these plans'}, 409);
			server.entries[body.key] = {value: body.value, revision: body.revision + 1};
			return json({revision: body.revision + 1});
		}
		if (action === 'revisions') return json({instance: server.instance, entries: Object.fromEntries(Object.entries(server.entries).map(([key, entry]) => [key, entry.revision]))});
		return json({instance: server.instance, entries: server.entries});
	};
	t.after(() => { for (const storage of disposables) storage.dispose(); globalThis.fetch = originalFetch; globalThis.window = originalWindow; });
	server.track = storage => disposables.push(storage);
	server.storage = async (browser = new MemoryStorage()) => {
		const storage = new SharedAppStorage({authenticated: true, csrf: 'test-csrf'}, browser);
		server.track(storage);
		await storage.initialize();
		return storage;
	};
	server.reloads = () => reloads;
	return server;
}

test('a plan saved on one device is available to a separate fresh device', async t => {
	const server = serverFixture(t);
	const desktop = await server.storage();
	desktop.setItem(key, store([plan('iron', 'Iron factory')]));
	await desktop.flush();
	assert.equal(desktop.state(), 'saved');
	const phone = await server.storage();
	assert.equal(JSON.parse(phone.getItem(key)).plans[0].name, 'Iron factory');
});

test('first sign-in imports browser plans without replacing server plans, and only imports once', async t => {
	const server = serverFixture(t, {[key]: {value: store([plan('server')]), revision: 1}});
	const browser = new MemoryStorage({[key]: store([plan('local')]), 'sftools.settings': '{"theme":"dark"}'});
	const first = await server.storage(browser);
	assert.deepEqual(JSON.parse(server.entries[key].value).plans.map(plan => plan.id), ['server', 'local']);
	assert.equal(browser.getItem('sftools.settings'), '{"theme":"dark"}');
	assert.equal(browser.getItem(key), null, 'accepted legacy copies no longer consume browser quota');
	first.dispose();
	await server.storage(browser);
	assert.equal(server.writes.length, 1);
});

test('conflicting imported trees get fresh IDs and keep folder, subplan and graph relationships', () => {
	const local = store([
		plan('root', 'Local', {folderId: 'folder', graph: {nodes: [{id: 'node', type: 'subplan', subplanId: 'child'}], edges: []}}),
		plan('child', 'Child', {parentPlanId: 'root'}),
	], [{id: 'folder', name: 'Folder', parentId: null}]);
	const merged = JSON.parse(mergeLibraryImport(key, local, store([plan('root', 'Server')])));
	assert.equal(merged.plans.find(plan => plan.id === 'root').name, 'Server');
	const root = merged.plans.find(plan => plan.name === 'Local');
	const child = merged.plans.find(plan => plan.name === 'Child');
	const folder = merged.folders.find(folder => folder.name === 'Folder');
	assert.notEqual(root.id, 'root');
	assert.equal(child.parentPlanId, root.id);
	assert.equal(root.folderId, folder.id);
	assert.equal(root.graph.nodes[0].subplanId, child.id);
	assert.equal(merged.folders.find(entry => entry.id === folder.parentId).name, 'Imported browser plans');
});

test('legacy browser stores without folders normalize before upload, and custom versions merge', () => {
	assert.deepEqual(JSON.parse(mergeLibraryImport(key, JSON.stringify({plans: [plan('legacy')]}), null)).folders, []);
	assert.deepEqual(JSON.parse(mergeLibraryImport('sftools.customVersions', '["local","same"]', '["server","same"]')), ['server', 'same', 'local']);
	assert.throws(() => mergeLibraryImport(key, 'null', null), /invalid/);
});

test('rapid edits while a save is in flight are serialized using the acknowledged revision', async t => {
	const server = serverFixture(t);
	const storage = await server.storage();
	let release;
	server.beforePut = () => new Promise(resolve => { release = resolve; server.beforePut = null; });
	storage.setItem(key, store([plan('p', 'First')]));
	const saving = storage.flush();
	storage.setItem(key, store([plan('p', 'Second')]));
	release();
	await saving;
	assert.deepEqual(server.writes.map(write => write.revision), [0, 1]);
	assert.equal(JSON.parse(server.entries[key].value).plans[0].name, 'Second');
});

test('offline edits survive closing the page and save when that browser reconnects', async t => {
	const server = serverFixture(t);
	const browser = new MemoryStorage();
	const first = await server.storage(browser);
	server.offline = true;
	first.setItem(key, store([plan('offline')]));
	await first.flush();
	assert.equal(first.state(), 'offline');
	assert.equal(JSON.parse(browser.getItem(journalKey)).dirty[key], first.getItem(key));
	first.dispose();
	server.offline = false;
	const recovered = await server.storage(browser);
	assert.equal(recovered.state(), 'saved');
	assert.equal(JSON.parse(server.entries[key].value).plans[0].id, 'offline');
});

test('stale devices cannot overwrite a newer save, and recovery preserves both copies', async t => {
	const server = serverFixture(t, {[key]: {value: store([plan('same', 'Original')]), revision: 1}});
	const desktop = await server.storage();
	const phone = await server.storage();
	desktop.setItem(key, store([plan('same', 'Desktop edit')]));
	await desktop.flush();
	phone.setItem(key, store([plan('same', 'Phone edit')]));
	await phone.flush();
	assert.equal(phone.state(), 'conflict');
	assert.equal(JSON.parse(server.entries[key].value).plans[0].name, 'Desktop edit');
	await phone.saveRecoveryCopy();
	assert.deepEqual(JSON.parse(server.entries[key].value).plans.map(plan => plan.name), ['Desktop edit', 'Phone edit']);
	assert.equal(server.reloads(), 1);
});

test('a reopened browser keeps its unsaved draft in conflict if another device saved meanwhile', async t => {
	const server = serverFixture(t, {[key]: {value: store([plan('p', 'Server')]), revision: 2}});
	const draft = store([plan('p', 'Unsaved')]);
	const browser = new MemoryStorage({[journalKey]: JSON.stringify({instance: 'server-1', dirty: {[key]: draft}, revisions: {[key]: 1}})});
	const storage = await server.storage(browser);
	assert.equal(storage.state(), 'conflict');
	assert.equal(storage.getItem(key), draft);
	assert.equal(server.writes.length, 0);
	storage.dispose();
	const again = await server.storage(browser);
	assert.equal(again.state(), 'conflict', 'reopening a conflict again must never turn it into an authorized overwrite');
	assert.equal(server.writes.length, 0);
});

test('a lost save acknowledgement is recovered when the server already has the exact draft', async t => {
	const saved = store([plan('p', 'Already committed')]);
	const server = serverFixture(t, {[key]: {value: saved, revision: 2}});
	const browser = new MemoryStorage({[journalKey]: JSON.stringify({instance: 'server-1', dirty: {[key]: saved}, revisions: {[key]: 1}})});
	const storage = await server.storage(browser);
	assert.equal(storage.state(), 'saved');
	assert.equal(server.writes.length, 0);
});

test('clean stale browser caches never resurrect plans deleted on the server', async t => {
	const server = serverFixture(t, {[key]: {value: null, revision: 3}});
	const browser = new MemoryStorage({[key]: store([plan('deleted')]), [journalKey]: JSON.stringify({instance: 'server-1', dirty: {}, revisions: {[key]: 2}})});
	const storage = await server.storage(browser);
	assert.equal(storage.getItem(key), null);
	assert.equal(server.writes.length, 0);
});

test('unsaved drafts are recovered if the server data volume was replaced', async t => {
	const server = serverFixture(t);
	const draft = store([plan('recovery')]);
	const browser = new MemoryStorage({[journalKey]: JSON.stringify({instance: 'previous-server', dirty: {[key]: draft}, revisions: {[key]: 12}})});
	const storage = await server.storage(browser);
	assert.equal(storage.state(), 'saved');
	assert.equal(JSON.parse(server.entries[key].value).plans[0].id, 'recovery');
});

test('failed initial loads never replace browser plans with an empty server library', async t => {
	const server = serverFixture(t);
	const old = store([plan('safe')]);
	const browser = new MemoryStorage({[key]: old});
	server.offline = true;
	const storage = new SharedAppStorage({authenticated: true, csrf: 'test-csrf'}, browser);
	server.track(storage);
	await assert.rejects(storage.initialize(), /Network unavailable/);
	assert.equal(browser.getItem(key), old);
	assert.equal(browser.getItem(journalKey), null);
});

test('browser quota exhaustion does not stop online server saves', async t => {
	const server = serverFixture(t);
	const browser = new MemoryStorage();
	browser.setItem = () => { throw new Error('QuotaExceededError'); };
	const storage = await server.storage(browser);
	storage.setItem(key, store([plan('large')]));
	await storage.flush();
	assert.equal(storage.state(), 'saved');
	assert.equal(storage.browserBackupAvailable(), false);
	assert.equal(JSON.parse(server.entries[key].value).plans[0].id, 'large');
});

test('expired sessions keep unsaved edits instead of silently switching to browser-only mode', async t => {
	const server = serverFixture(t);
	const storage = await server.storage();
	server.unauthorized = true;
	storage.setItem(key, store([plan('pending')]));
	await storage.flush();
	assert.equal(storage.state(), 'signed-out');
	assert.equal(JSON.parse(storage.getItem(key)).plans[0].id, 'pending');
});

test('production bootstrap refuses an unavailable private library instead of silently using local storage', async t => {
	const server = serverFixture(t);
	server.offline = true;
	await assert.rejects(createAppStorage(), /Network unavailable/);
});
