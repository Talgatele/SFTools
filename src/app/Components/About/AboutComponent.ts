import {Component, ChangeDetectionStrategy} from '@angular/core';
import {RouterLink} from '@angular/router';
import {FaIconComponent} from '@fortawesome/angular-fontawesome';
import {faBookOpen, faDiagramProject, faPuzzlePiece, faSliders} from '@fortawesome/free-solid-svg-icons';
import {CreditList} from '@src/Model/About/CreditList';
import {BackLinkComponent} from '@src/Components/Common/BackLinkComponent';
import {HomeFeature} from '@src/Components/Home/HomeFeature';

@Component({
	templateUrl: './AboutComponent.html',
	changeDetection: ChangeDetectionStrategy.Eager,
	imports: [FaIconComponent, BackLinkComponent, RouterLink],
	styles: [`
		.about-hero {
			display: flex;
			align-items: center;
			gap: 1rem;
			margin: 1rem 0 1.5rem;
		}
		.about-hero img {
			height: 56px;
			filter: drop-shadow(0 6px 18px rgba(0, 0, 0, 0.45));
		}
		.section-title {
			font-size: 0.8rem;
			font-weight: 600;
			text-transform: uppercase;
			letter-spacing: 0.06em;
			color: #9fb0c0;
			margin: 1.75rem 0 0.75rem;
		}
		.feature-list {
			display: grid;
			grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
			gap: 0.75rem;
		}
		.feature {
			display: flex;
			gap: 0.9rem;
			padding: 0.9rem 1rem;
			background: var(--bs-dark);
			border: 1px solid #4e5d6c;
			color: inherit;
			text-decoration: none;
		}
		a.feature {
			transition: border-color 0.15s, background 0.15s;
		}
		a.feature:hover {
			border-color: var(--bs-primary);
			background: #243e56;
		}
		.feature-icon {
			flex-shrink: 0;
			width: 2.25rem;
			height: 2.25rem;
			display: inline-flex;
			align-items: center;
			justify-content: center;
			color: var(--bs-primary);
		}
		.feature-title {
			font-weight: 600;
			margin-bottom: 0.15rem;
		}
		.feature-text {
			font-size: 0.875rem;
			color: #9fb0c0;
			margin: 0;
		}
		.credits {
			background: var(--bs-dark);
			border: 1px solid #4e5d6c;
		}
		.credit {
			display: grid;
			grid-template-columns: 11rem minmax(0, 1fr);
			gap: 0.25rem 1rem;
			padding: 0.7rem 1rem;
			border-top: 1px solid rgba(78, 93, 108, 0.6);
		}
		.credit:first-child {
			border-top: 0;
		}
		@media (max-width: 575.98px) {
			.credit {
				grid-template-columns: minmax(0, 1fr);
			}
		}
		.credit-role {
			color: #9fb0c0;
			font-size: 0.875rem;
		}
		.credit-text {
			margin: 0;
		}
		.name-list {
			list-style: none;
			padding: 0;
			margin: 0;
			display: flex;
			flex-wrap: wrap;
			gap: 0.5rem;
		}
		.name-list li {
			padding: 0.3rem 0.75rem;
			background: var(--bs-dark);
			border: 1px solid #4e5d6c;
		}
	`],
})
export class AboutComponent
{

	public readonly creditGroups = CreditList.GROUPS;

	public readonly features: HomeFeature[];

	public constructor()
	{
		this.features = [
			{
				icon: faDiagramProject,
				title: 'Planner',
				text: 'Production plans worked out for you. Edit the graph by hand, add subplans and group plans in folders.',
				link: null,
			},
			{
				icon: faBookOpen,
				title: 'Codex',
				text: 'Browse the items, buildings, recipes and milestones of any game version. Search it from the planner too.',
				link: null,
			},
			{
				icon: faSliders,
				title: 'Custom versions',
				text: 'Make your own game version from a public one. Change recipe and power costs, add mods or load resource nodes from a world seed.',
				link: null,
			},
			{
				icon: faPuzzlePiece,
				title: 'Mods',
				text: 'New or changed items, recipes and buildings. Share them or keep them private.',
				link: null,
			},
		];
	}

}
