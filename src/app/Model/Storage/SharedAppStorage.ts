import {signal} from '@angular/core';
import {AppStorage} from '@src/Model/Storage/AppStorage';
import {BrowserAppStorage} from '@src/Model/Storage/BrowserAppStorage';
import {mergeLibraryImport} from '@src/Model/Storage/LibraryImport';
import {LibrarySession, libraryError, libraryRequest, showLibraryLogin} from '@src/Model/Storage/LibrarySession';

export interface LibraryEntry {value: string | null; revision: number;}
export interface LibrarySnapshot {instance: string; entries: Record<string, LibraryEntry>;}
type SaveState = 'saved' | 'saving' | 'offline' | 'conflict' | 'signed-out' | 'error' | 'updated';
interface BrowserJournal {instance: string; dirty: Record<string, string | null>; revisions: Record<string, number>;}
const JOURNAL = 'sftools.serverLibrary.journal';

export function isLibraryKey(key: string): boolean
{
	return key === 'sftools.customVersions' || /^sftools\.plans(?:\.[A-Za-z0-9_.:-]{1,160})?$/.test(key);
}

/** A synchronous in-memory view, hydrated before bootstrap, with serialized optimistic writes to the server. */
export class SharedAppStorage extends AppStorage
{
	public readonly state = signal<SaveState>('saved');
	public readonly message = signal('Plans saved to server');
	public readonly browserBackupAvailable = signal(true);
	private readonly values = new Map<string, string | null>();
	private readonly revisions: Record<string, number> = {};
	private readonly pending = new Map<string, string | null>();
	private inFlight: Promise<void> | null = null;
	private timer: ReturnType<typeof setTimeout> | null = null;
	private instance = '';
	private poll: ReturnType<typeof setInterval> | null = null;
	private disposed = false;
	private readonly onOnline = (): void => this.retry();
	private readonly onFocus = (): void => { void this.checkForUpdates(); };
	private readonly onUnload = (event: BeforeUnloadEvent): void => {
		if (this.pending.size > 0) { event.preventDefault(); event.returnValue = ''; }
	};

	public constructor(private session: LibrarySession, private readonly browser: AppStorage = new BrowserAppStorage())
	{
		super();
	}

	public async initialize(): Promise<void>
	{
		const snapshot = await this.snapshot();
		this.instance = snapshot.instance;
		let journal: BrowserJournal | null = null;
		try { journal = JSON.parse(this.browser.getItem(JOURNAL) ?? 'null') as BrowserJournal | null; } catch { /* First visit. */ }
		const local = new Map(this.browser.keys('sftools.').filter(isLibraryKey).map(key => [key, this.browser.getItem(key)]));
		for (const [key, entry] of Object.entries(snapshot.entries)) {
			this.values.set(key, entry.value);
			this.revisions[key] = entry.revision;
		}
		if (journal?.instance === this.instance) {
			// Recover only explicitly unsaved edits, not a stale cache of plans deleted elsewhere.
			for (const [key, value] of Object.entries(journal.dirty ?? {})) {
				if (!isLibraryKey(key)) continue;
				if (value !== null && typeof value !== 'string') continue;
				if (value === (snapshot.entries[key]?.value ?? null)) continue;
				this.values.set(key, value);
				this.pending.set(key, value);
				const baseline = journal.revisions?.[key] ?? 0;
				if (baseline !== (this.revisions[key] ?? 0)) {
					this.setState('conflict', 'Another device changed these plans while this browser had unsaved edits.');
				}
				// Keep the draft's original revision across further restarts until explicitly recovered.
				this.revisions[key] = baseline;
			}
		} else {
			// First visit after upgrade (or a new server volume): import all old browser plans once.
			const imports = new Map(local);
			for (const [key, value] of Object.entries(journal?.dirty ?? {})) {
				if (isLibraryKey(key) && typeof value === 'string') imports.set(key, value);
			}
			for (const [key, value] of imports) {
				if (value === null) continue;
				const merged = mergeLibraryImport(key, value, snapshot.entries[key]?.value ?? null);
				if (merged !== snapshot.entries[key]?.value) {
					this.values.set(key, merged);
					this.pending.set(key, merged);
				}
			}
		}
		this.backup();
		if (this.state() !== 'conflict') await this.flush();
		window.addEventListener('online', this.onOnline);
		window.addEventListener('focus', this.onFocus);
		window.addEventListener('beforeunload', this.onUnload);
		this.poll = setInterval(this.onFocus, 30000);
	}

	public dispose(): void
	{
		this.disposed = true;
		if (this.timer !== null) clearTimeout(this.timer);
		if (this.poll !== null) clearInterval(this.poll);
		window.removeEventListener('online', this.onOnline);
		window.removeEventListener('focus', this.onFocus);
		window.removeEventListener('beforeunload', this.onUnload);
	}

	public reloadLibrary(): void
	{
		if (this.pending.size === 0) window.location.reload();
	}

	public getItem(key: string): string | null
	{
		return isLibraryKey(key) ? this.values.get(key) ?? null : this.browser.getItem(key);
	}

	public setItem(key: string, value: string): void
	{
		if (!isLibraryKey(key)) { this.browser.setItem(key, value); return; }
		this.queue(key, value);
	}

	public removeItem(key: string): void
	{
		if (!isLibraryKey(key)) { this.browser.removeItem(key); return; }
		this.queue(key, null);
	}

	public keys(prefix: string): string[]
	{
		return [...new Set([
			...this.browser.keys(prefix).filter(key => !isLibraryKey(key)),
			...[...this.values].filter(([key, value]) => key.startsWith(prefix) && value !== null).map(([key]) => key),
		])];
	}

	private queue(key: string, value: string | null): void
	{
		if (this.values.get(key) === value) return;
		this.values.set(key, value);
		this.pending.set(key, value);
		this.backup();
		if (this.state() === 'conflict' || this.state() === 'signed-out') return;
		this.setState('saving', 'Saving plans to server…');
		if (this.timer !== null) clearTimeout(this.timer);
		this.timer = setTimeout(() => { this.timer = null; void this.flush(); }, 300);
	}

	public retry(): void
	{
		if (this.state() === 'conflict' || this.state() === 'signed-out') return;
		void this.flush();
	}

	public async signIn(): Promise<void>
	{
		const conflicted = this.state() === 'conflict';
		this.session = await showLibraryLogin();
		if (conflicted) return;
		this.setState('saving', 'Saving plans to server…');
		await this.flush();
	}

	public async logout(): Promise<void>
	{
		await this.flush();
		if (this.pending.size > 0) return;
		try {
			const response = await libraryRequest('logout', {method: 'POST', headers: {'X-SFTOOLS-CSRF': this.session.csrf ?? ''}});
			if (!response.ok) { this.setState('signed-out', await libraryError(response)); return; }
		} catch { this.setState('offline', 'Could not log out. Check your connection and try again.'); return; }
		for (const key of this.browser.keys('sftools.').filter(isLibraryKey)) this.browser.removeItem(key);
		this.browser.removeItem(JOURNAL);
		window.location.reload();
	}

	/** User explicitly preserves conflicting edits as a separate imported tree, then reloads the latest server view. */
	public async saveRecoveryCopy(): Promise<void>
	{
		try {
			const latest = await this.snapshot();
			for (const [key, value] of this.pending) {
				const remote = latest.entries[key];
				// A stale delete must never remove another device's newer plan.
				if (value === null) { this.pending.delete(key); continue; }
				const merged = mergeLibraryImport(key, value, remote?.value ?? null);
				this.values.set(key, merged);
				this.pending.set(key, merged);
				this.revisions[key] = remote?.revision ?? 0;
			}
			this.backup();
			this.setState('saving', 'Saving a recovery copy…');
			await this.flush();
			if (this.pending.size === 0) window.location.reload();
		} catch {
			this.setState('conflict', 'Could not save the recovery copy. Your edits are still on this device.');
		}
	}

	public downloadBackup(): void
	{
		const entries = Object.fromEntries([...this.values].filter(([, value]) => value !== null));
		const url = URL.createObjectURL(new Blob([JSON.stringify({type: 'sftools-server-backup', exportedAt: new Date().toISOString(), entries}, null, 2)], {type: 'application/json'}));
		const anchor = document.createElement('a');
		anchor.href = url;
		anchor.download = 'satisfactory-library-backup.json';
		anchor.click();
		setTimeout(() => URL.revokeObjectURL(url), 1000);
	}

	public async importBackup(file: File): Promise<void>
	{
		if (this.pending.size > 0) { this.message.set('Save or recover your current edits before importing a backup.'); return; }
		try {
			if (file.size > 64 * 1024 * 1024) throw new Error('The backup exceeds the 64 MiB file limit.');
			const backup = JSON.parse(await file.text()) as {type?: string; entries?: Record<string, unknown>};
			if (backup?.type !== 'sftools-server-backup' || backup.entries === null || typeof backup.entries !== 'object' || Array.isArray(backup.entries)) throw new Error('This is not a library backup.');
			const latest = await this.snapshot();
			const imported = new Map<string, string>();
			for (const [key, value] of Object.entries(backup.entries)) {
				if (!isLibraryKey(key) || typeof value !== 'string') throw new Error('The backup contains an invalid document.');
				const merged = mergeLibraryImport(key, value, latest.entries[key]?.value ?? null);
				imported.set(key, merged);
			}
			for (const [key, merged] of imported) {
				this.values.set(key, merged);
				this.pending.set(key, merged);
				this.revisions[key] = latest.entries[key]?.revision ?? 0;
			}
			this.backup();
			this.setState('saving', 'Importing library backup…');
			await this.flush();
			if (this.pending.size === 0) window.location.reload();
		} catch (error) {
			this.setState('error', error instanceof Error ? error.message : 'The library backup could not be imported.');
		}
	}

	public flush(): Promise<void>
	{
		if (this.disposed) return Promise.resolve();
		if (this.timer !== null) { clearTimeout(this.timer); this.timer = null; }
		if (this.inFlight !== null) return this.inFlight;
		if (this.state() === 'conflict' || this.state() === 'signed-out') return Promise.resolve();
		this.inFlight = this.sendPending().finally(() => { this.inFlight = null; });
		return this.inFlight;
	}

	private async sendPending(): Promise<void>
	{
		while (this.pending.size > 0) {
			const [key, value] = this.pending.entries().next().value!;
			this.setState('saving', 'Saving plans to server…');
			try {
				const response = await libraryRequest('data', {
					method: 'PUT', headers: {'Content-Type': 'application/json', 'X-SFTOOLS-CSRF': this.session.csrf ?? ''},
					body: JSON.stringify({key, value, revision: this.revisions[key] ?? 0}),
				});
				if (!response.ok) {
					const message = await libraryError(response);
					if (response.status === 409) { this.setState('conflict', message); return; }
					if (response.status === 401 || response.status === 403) { this.setState('signed-out', message); return; }
					if (response.status >= 400 && response.status < 500) { this.setState('error', message); return; }
					throw new Error(message);
				}
				const result = await response.json() as {revision: number};
				this.revisions[key] = result.revision;
				if (this.pending.get(key) === value) this.pending.delete(key);
				this.backup();
			} catch (error) {
				this.setState('offline', `Not saved to server: ${error instanceof Error ? error.message : 'connection unavailable'}. Keep this page open or download a backup.`);
				if (!this.disposed) this.timer = setTimeout(() => { this.timer = null; this.retry(); }, 5000);
				return;
			}
		}
		this.setState('saved', 'Plans saved to server');
	}

	private async snapshot(): Promise<LibrarySnapshot>
	{
		const response = await libraryRequest('data');
		if (!response.ok) throw new Error(await libraryError(response));
		return response.json() as Promise<LibrarySnapshot>;
	}

	private async checkForUpdates(): Promise<void>
	{
		if (this.disposed || this.pending.size > 0 || this.inFlight !== null || this.state() === 'signed-out') return;
		try {
			const response = await libraryRequest('revisions');
			if (response.status === 401) { this.setState('signed-out', 'Sign in again to keep accessing your server library.'); return; }
			if (!response.ok) return;
			const latest = await response.json() as {instance: string; entries: Record<string, number>};
			if (this.pending.size > 0) return;
			if (latest.instance !== this.instance || Object.entries(latest.entries).some(([key, revision]) => revision !== this.revisions[key])) {
				this.setState('updated', 'Plans changed on another device. Refresh your library to see them.');
			}
		} catch { /* A failed background check must not discard an already loaded library. */ }
	}

	private backup(): void
	{
		try {
			// One atomic localStorage write contains the actual unsaved values and their base revisions.
			this.browser.setItem(JOURNAL, JSON.stringify({instance: this.instance, dirty: Object.fromEntries(this.pending), revisions: this.revisions}));
			// Once the server has accepted everything, the old browser-only copies are redundant.
			if (this.pending.size === 0) for (const key of this.browser.keys('sftools.').filter(isLibraryKey)) this.browser.removeItem(key);
			this.browserBackupAvailable.set(true);
		} catch {
			// A browser quota failure must not prevent an online server save.
			this.browserBackupAvailable.set(false);
		}
	}

	private setState(state: SaveState, message: string): void
	{
		this.state.set(state);
		this.message.set(message);
	}
}

export async function createAppStorage(): Promise<AppStorage>
{
	const response = await libraryRequest('session');
	if (['localhost', '127.0.0.1', '[::1]'].includes(window.location.hostname)
		&& (response.status === 404 || (response.ok && !response.headers.get('Content-Type')?.includes('application/json')))) return new BrowserAppStorage();
	if (!response.ok) throw new Error(await libraryError(response));
	let session = await response.json() as LibrarySession;
	if (!session.authenticated) session = await showLibraryLogin();
	const storage = new SharedAppStorage(session);
	await storage.initialize();
	return storage;
}
