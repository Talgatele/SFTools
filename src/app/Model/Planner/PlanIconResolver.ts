import {Injectable} from '@angular/core';
import {VersionManager} from '@src/Model/Data/VersionManager';
import {Plan} from '@src/Model/Planner/Plan';
import {PlanLabelAssigner} from '@src/Model/Planner/PlanLabelAssigner';

@Injectable({providedIn: 'root'})
export class PlanIconResolver
{

	public constructor(
		private readonly versionManager: VersionManager,
		private readonly labels: PlanLabelAssigner,
	)
	{
	}

	public iconHash(plan: Plan): string | null
	{
		const data = this.versionManager.activeVersionData();
		if (!data) {
			return null;
		}
		// Resolve automatic icons from current outputs, including stored plans not yet edited
		// since the hierarchy changed. Manual icons and explicit "no icon" remain unchanged.
		const className = this.labels.assign(plan).iconClassName ?? null;
		return className === null ? null : data.iconForClassName(className);
	}

}
