import {Component, ChangeDetectionStrategy} from '@angular/core';
import {AppStorage} from '@src/Model/Storage/AppStorage';
import {SharedAppStorage} from '@src/Model/Storage/SharedAppStorage';

@Component({
	selector: 'library-status',
	changeDetection: ChangeDetectionStrategy.Eager,
	template: `
		@if (library; as storage) {
			<div class="library-status shadow-sm" [class.problem]="storage.state() !== 'saved' && storage.state() !== 'saving'">
				<span role="status" aria-live="polite">{{ storage.message() }}</span>
				@if (!storage.browserBackupAvailable()) {
					<span class="text-warning">Browser backup is full. Keep this page open until saved.</span>
				}
				<div class="d-flex flex-wrap gap-2">
					@if (storage.state() === 'saved' || storage.state() === 'updated') {
						<button type="button" class="btn btn-sm btn-link text-reset p-0" (click)="storage.reloadLibrary()">Refresh library</button>
					}
					@if (storage.state() === 'offline' || storage.state() === 'error') {
						<button type="button" class="btn btn-sm btn-outline-light" (click)="storage.retry()">Retry save</button>
					}
					@if (storage.state() === 'signed-out' || storage.state() === 'conflict') {
						<button type="button" class="btn btn-sm btn-outline-light" (click)="storage.signIn()">Sign in again</button>
					}
					@if (storage.state() === 'conflict') {
						<button type="button" class="btn btn-sm btn-outline-light" (click)="storage.saveRecoveryCopy()">Save my edits as a copy</button>
					}
					<button type="button" class="btn btn-sm btn-link text-reset p-0" (click)="storage.downloadBackup()">Download backup</button>
					@if (storage.state() === 'saved') {
						<button type="button" class="btn btn-sm btn-link text-reset p-0" (click)="backupInput.click()">Import backup</button>
					}
					<input #backupInput type="file" accept=".json,application/json" hidden (change)="importBackup($event)">
					<button type="button" class="btn btn-sm btn-link text-reset p-0" (click)="storage.logout()">Log out</button>
				</div>
			</div>
		}
	`,
	styles: `
		.library-status { position: fixed; bottom: .5rem; left: .5rem; z-index: 1060; max-width: min(540px, calc(100vw - 1rem)); padding: .45rem .7rem; background: #263b45; color: #d2eedb; border: 1px solid #4c7860; border-radius: .25rem; font-size: .8rem; }
		.library-status.problem { background: #522c29; color: #fff; border-color: #b85d50; }
	`,
})
export class LibraryStatusComponent
{
	protected readonly library: SharedAppStorage | null;

	public constructor(storage: AppStorage)
	{
		this.library = storage instanceof SharedAppStorage ? storage : null;
	}

	protected importBackup(event: Event): void
	{
		const input = event.target as HTMLInputElement;
		const file = input.files?.[0];
		input.value = '';
		if (file !== undefined) void this.library?.importBackup(file);
	}
}
