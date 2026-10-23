import {Routes, UrlMatchResult, UrlSegment} from '@angular/router';
import {ContentComponent} from '@src/Components/Root/ContentComponent';
import {HomeComponent} from '@src/Components/Home/HomeComponent';
import {VersionContextComponent} from '@src/Components/Version/VersionContextComponent';
import {CodexPageComponent} from '@src/Components/Codex/CodexPageComponent';
import {HelpPageComponent} from '@src/Components/Help/HelpPageComponent';
import {AboutComponent} from '@src/Components/About/AboutComponent';
import {CreateVersionPageComponent} from '@src/Components/Versions/CreateVersionPageComponent';
import {ModDetailComponent} from '@src/Components/Mods/ModDetailComponent';
import {ModEditorComponent} from '@src/Components/ModEditor/ModEditorComponent';
import {ModListComponent} from '@src/Components/Mods/ModListComponent';
import {PlannerComponent} from '@src/Components/Planner/PlannerComponent';
import {SettingsComponent} from '@src/Components/Settings/SettingsComponent';
import {ShareRedirectComponent} from '@src/Components/Shares/ShareRedirectComponent';
import {HomeRedirectGuard} from '@src/Model/Planner/HomeRedirectGuard';
import {NotFoundComponent} from '@src/Components/Errors/NotFoundComponent';
import {LegacyUrlRedirectComponent} from '@src/Components/Legacy/LegacyUrlRedirectComponent';
import {VersionsResolver} from '@src/Model/Data/VersionsResolver';
import {VersionDataResolver} from '@src/Model/Data/VersionDataResolver';
import {SettingsResolver} from '@src/Model/Settings/SettingsResolver';

export class RouteList
{

	/** One route for 'codex' and any codex path below it, so browsing reuses the component. */
	public static codexMatcher(segments: UrlSegment[]): UrlMatchResult | null
	{
		if (segments.length < 1 || segments[0].path !== 'codex') {
			return null;
		}
		return {consumed: segments, posParams: {}};
	}

	/** One route for 'help' and the slug below it, so moving between articles reuses the component. */
	public static helpMatcher(segments: UrlSegment[]): UrlMatchResult | null
	{
		if (segments.length < 1 || segments.length > 2 || segments[0].path !== 'help') {
			return null;
		}
		return {consumed: segments, posParams: {}};
	}

	/** One route for 'planner', 'planner/:planId' and 'planner/shared/:shareId', so switching plans reuses the component; plan ids are UUIDs, so 'shared' cannot collide. */
	public static plannerMatcher(segments: UrlSegment[]): UrlMatchResult | null
	{
		if (segments.length < 1 || segments.length > 3 || segments[0].path !== 'planner') {
			return null;
		}
		if (segments.length === 3) {
			if (segments[1].path !== 'shared') {
				return null;
			}
			return {consumed: segments, posParams: {shareId: segments[2]}};
		}
		const posParams: Record<string, UrlSegment> = {};
		if (segments.length === 2) {
			posParams['planId'] = segments[1];
		}
		return {consumed: segments, posParams};
	}

	public static legacyMatcher(segments: UrlSegment[]): UrlMatchResult | null
	{
		if (segments.length < 1 || !RouteList.LEGACY_FIRST_SEGMENTS.includes(segments[0].path)) {
			return null;
		}
		return {consumed: segments, posParams: {}};
	}

	private static readonly LEGACY_FIRST_SEGMENTS: ReadonlyArray<string> = ['0.8', '1.0', '1.0-ficsmas', 'production', 'codex', 'items'];

	// Titles and descriptions are mirrored by tools-api's MetaResolver (which also mirrors the reserved first segments) - keep them in sync.
	public static routes: Routes = [
		{
			path: '',
			component: ContentComponent,
			resolve: {
				versions: VersionsResolver,
				settings: SettingsResolver,
			},
			children: [
				{
					path: '',
					component: HomeComponent,
					canActivate: [HomeRedirectGuard],
				},
				{
					path: 'settings',
					title: 'Settings',
					component: SettingsComponent,
				},
				{
					path: 'settings/:section',
					title: 'Settings',
					component: SettingsComponent,
				},
				{
					path: 'about',
					title: 'About',
					data: {description: 'Who makes Satisfactory Tools and what it can do.'},
					component: AboutComponent,
				},
				{
					path: 'create-version',
					title: 'Create custom version',
					data: {description: 'Make your own game version: add mods, change recipe and power costs, and set up a different world.'},
					component: CreateVersionPageComponent,
				},
				// Must precede the ':versionSlug' catch-all.
				{
					path: 'mods',
					title: 'Mods',
					data: {description: 'Browse public mod data and create local mod data for custom game versions.'},
					children: [
						{
							path: '',
							component: ModListComponent,
						},
						{
							path: ':modId',
							component: ModDetailComponent,
						},
						{
							path: ':modId/versions/:modVersionId/data',
							component: ModEditorComponent,
						},
					],
				},
				{
					path: 'mod-editor',
					title: 'Mod editor',
					data: {description: 'Write the items, recipes and buildings of a mod and get the data file to upload.'},
					component: ModEditorComponent,
				},
				// Accounts and remote help editing are disabled in this local-only build.
				{path: 'help/editor', redirectTo: '/', pathMatch: 'prefix'},
				{
					// Must precede the ':versionSlug' catch-all.
					matcher: RouteList.helpMatcher,
					title: 'Help',
					data: {description: 'Guides and reference for Satisfactory Tools.'},
					component: HelpPageComponent,
				},
				{path: 'auth', redirectTo: '/', pathMatch: 'prefix'},
				{path: 'account', redirectTo: '/', pathMatch: 'prefix'},
				{
					// Must precede the ':versionSlug' catch-all.
					path: 'shared/:shareId',
					component: ShareRedirectComponent,
				},
				{
					// Must precede the ':versionSlug' catch-all, which would send them home.
					matcher: RouteList.legacyMatcher,
					component: LegacyUrlRedirectComponent,
				},
				{
					path: ':versionSlug',
					component: VersionContextComponent,
					resolve: {
						versionData: VersionDataResolver,
					},
					children: [
						{
							path: '',
							redirectTo: 'planner',
							pathMatch: 'full',
						},
						{
							matcher: RouteList.codexMatcher,
							title: 'Codex ({V})',
							data: {description: 'Searchable codex of items, recipes, buildings and schematics in Satisfactory ({V}).'},
							component: CodexPageComponent,
						},
						{
							matcher: RouteList.plannerMatcher,
							title: 'Planner ({V})',
							component: PlannerComponent,
						},
						{
							path: '**',
							component: NotFoundComponent,
						},
					],
				},
				{
					path: '**',
					component: NotFoundComponent,
				},
			],
		},
	];

}
