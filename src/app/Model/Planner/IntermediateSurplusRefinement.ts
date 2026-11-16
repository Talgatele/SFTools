import {FactoryRefinement} from '@src/Model/Planner/SatisfactoryFactoryRefinement';

/** Reduce the selected factory's surplus by underclocking, without changing its outputs or routes. */
export class IntermediateSurplusRefinement implements FactoryRefinement
{
	public readonly constraints: string[] = [];
	public readonly generals: string[] = [];
	public readonly binaries: string[] = [];
	public readonly productionRanges = new Map<string, {minimum: number; maximum: number}>();
	public readonly objective: string;

	public constructor(baseline: Map<string, number>, requestedItems: Set<string>)
	{
		const waste: string[] = [];
		for (const [variable, amount] of baseline) {
			// Auxiliary variables belong to the earlier rounding pass, not to this model.
			if (variable.startsWith('sf_') || variable === 'MaxRate' || variable.endsWith('@Product')
				|| variable === 'PowerSurplus' || variable === 'SinkPointsSurplus') continue;
			const [item, kind] = variable.split('@');
			if (kind === 'Byproduct') {
				// Requested surplus is reserved as a product by the caller.
				this.constraints.push(`${variable} <= ${requestedItems.has(item) ? 0 : Math.max(0, amount)}`);
				if (!requestedItems.has(item)) waste.push(variable);
			} else if (kind?.startsWith('Gen%')) {
				// Keep generators unchanged, including any power target or factory power reserve.
				this.constraints.push(`${variable} = ${Math.max(0, amount)}`);
			} else {
				// No additional resources, machines, sinks or somersloops, and no unused routes.
				this.constraints.push(`${variable} <= ${Math.max(0, amount)}`);
			}
		}
		this.objective = waste.map(variable => `+ 1 ${variable}`).join('\n');
	}
}
