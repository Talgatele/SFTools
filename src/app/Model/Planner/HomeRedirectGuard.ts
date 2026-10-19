import {Injector, Injectable} from '@angular/core';
import {toObservable} from '@angular/core/rxjs-interop';
import {Router, UrlTree} from '@angular/router';
import {Observable} from 'rxjs';
import {filter, map, take} from 'rxjs/operators';
import {VersionManager} from '@src/Model/Data/VersionManager';
import {PlannerLocationService} from '@src/Model/Planner/PlannerLocationService';

@Injectable({providedIn: 'root'})
export class HomeRedirectGuard
{
	public constructor(
		private readonly router: Router,
		private readonly plannerLocation: PlannerLocationService,
		private readonly versionManager: VersionManager,
		private readonly injector: Injector,
	)
	{
	}

	public canActivate(): boolean | UrlTree | Observable<boolean | UrlTree>
	{
		// Only redirect the launch URL. Later visits to Home remain explicit navigation.
		if (this.router.navigated) {
			return true;
		}

		// The route's version resolver runs after guards, so wait until the saved slug can be resolved.
		return toObservable(this.versionManager.ready, {injector: this.injector}).pipe(
			filter(ready => ready),
			take(1),
			map(() => {
				const location = this.plannerLocation.location();
				const version = location === null ? null : this.versionManager.findByUrlSlug(location.versionSlug);
				if (location === null || version === null) {
					return true;
				}

				const commands = ['/', this.versionManager.urlSlug(version), 'planner'];
				if (location.planId !== null) {
					commands.push(location.planId);
				}
				return this.router.createUrlTree(commands);
			}),
		);
	}

}
