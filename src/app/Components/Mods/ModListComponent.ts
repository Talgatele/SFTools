import {Component, ChangeDetectionStrategy} from '@angular/core';
import {DatePipe} from '@angular/common';
import {RouterLink} from '@angular/router';
import {ModsApiService} from '@src/Model/API/ModsApiService';
import {Mod} from '@src/Model/API/Schema/Mods/Mod';
import {BackLinkComponent} from '@src/Components/Common/BackLinkComponent';
import {HelpButtonComponent} from '@src/Components/Help/HelpButtonComponent';

@Component({
	templateUrl: './ModListComponent.html',
	changeDetection: ChangeDetectionStrategy.Eager,
	imports: [DatePipe, RouterLink, BackLinkComponent, HelpButtonComponent],
})
export class ModListComponent
{


	public mods: Mod[] = [];
	public loading = true;
	public loadError: string | null = null;

	public constructor(
		private readonly modsApi: ModsApiService,
	)
	{
		this.modsApi.listMods().subscribe({
			next: mods => {
				this.mods = mods;
				this.loading = false;
			},
			error: () => {
				this.loadError = 'Could not load mods.';
				this.loading = false;
			},
		});
	}

	public get publicMods(): Mod[]
	{
		return this.mods.filter(mod => mod.public);
	}

}
