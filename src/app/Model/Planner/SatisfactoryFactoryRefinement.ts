import {Formulas} from '@src/Model/Planner/Formulas';
import {SolverRequest} from '@src/Model/Planner/Solver/Request/SolverRequest';

interface RateRange
{
	minimum: number;
	maximum: number;
}

interface SimplicityMetric
{
	variable: string;
	coefficient: number;
	weight: number;
}

/** A bounded second pass over the chosen routes, rather than a new recipe search. */
export class SatisfactoryFactoryRefinement
{
	public readonly constraints: string[] = [];
	public readonly generals: string[] = [];
	public readonly binaries: string[] = [];
	public readonly productionRanges = new Map<string, RateRange>();
	private readonly objectiveTerms: string[] = [];
	private readonly metrics: SimplicityMetric[] = [];

	public constructor(request: SolverRequest, baseline: Map<string, number>, automaticCaps: Map<string, number>)
	{
		for (const [item, cap] of automaticCaps) {
			const rate = baseline.get(item + '@Product') ?? 0;
			// Tiny outputs cannot usefully be made round; do not spend their throughput allowance.
			this.productionRanges.set(item, rate < 0.1 ? {minimum: rate, maximum: rate} : {
				minimum: rate * 0.98,
				maximum: Math.min(cap, rate * 1.02),
			});
			if (rate > 0) {
				// Throughput breaks ties, after internal simplicity. Final outputs have no grid penalty.
				this.objectiveTerms.push(`- ${0.001 / (rate * automaticCaps.size)} ${item}@Product`);
			}
		}

		const recipes = new Map(request.recipes.map(recipe => [recipe.className, recipe]));
		const machineTerms: string[] = [];
		let baselineMachines = 0;
		for (const [variable, amount] of baseline) {
			if (variable.endsWith('@Byproduct') || variable.endsWith('@Sink') || variable.endsWith('_count')) {
				// Do not manufacture waste, burn extra sink items, or spend more sloops to look round.
				this.constraints.push(`${variable} <= ${Math.max(0, amount)}`);
				continue;
			}
			const [recipeClass, kind] = variable.split('@');
			if (!kind?.includes('%') || kind.startsWith('Gen%')) continue;
			if (amount <= 1e-6) {
				this.constraints.push(`${variable} = 0`);
				continue;
			}
			const [machineClass, metadata] = kind.split('%');
			const [clock, sloops] = metadata.split('#').map(Number);
			const recipe = recipes.get(recipeClass)!;
			const machine = recipe.producedIn.find(candidate => candidate.className === machineClass)!;
			const speed = Formulas.referenceCycles(recipe, machine) * clock / 100;
			const boost = Formulas.sloopOutputMultiplier(machine, sloops);
			// Identical rates on one group need only one set of integer grid variables.
			const rates = new Set([
				...recipe.ingredients.map(ingredient => ingredient.amount * speed),
				...recipe.products.map(product => product.amount * speed * boost),
			]);
			for (const coefficient of rates) {
				if (coefficient <= 0) continue;
				this.addMetric(variable, coefficient, 1);
				this.addMetric(variable, coefficient * 2, 0.25);
				this.addMetric(variable, coefficient * 10, 0.1);
			}
			// Whole configured machines, then 5% and 1% remainders. Flow simplicity wins.
			this.addMetric(variable, 1, 0.05);
			this.addMetric(variable, clock / 5, 0.03);
			this.addMetric(variable, clock, 0.01);
			const machines = 'sf_build_' + machineTerms.length;
			this.generals.push(machines);
			this.constraints.push(`${machines} - ${variable} >= 0`);
			this.objectiveTerms.push(`+ 0.000001 ${machines}`);
			machineTerms.push(machines);
			baselineMachines += Math.ceil(amount - 1e-9);
		}
		if (machineTerms.length > 0) {
			this.constraints.push(`${machineTerms.join(' + ')} <= ${baselineMachines + 2}`);
		}
	}

	public get objective(): string
	{
		return this.objectiveTerms.join('\n');
	}

	public score(columns: Map<string, number>): number
	{
		return this.metrics.reduce((sum, metric) => {
			const rate = metric.coefficient * (columns.get(metric.variable) ?? 0);
			const distance = Math.abs(rate - Math.round(rate));
			return sum + (distance <= 1e-5 ? 0 : metric.weight * (1 + 0.01 * distance));
		}, 0);
	}

	private addMetric(variable: string, coefficient: number, weight: number): void
	{
		const id = 'sf_' + this.metrics.length;
		this.metrics.push({variable, coefficient, weight});
		this.generals.push(id + '_grid');
		this.binaries.push(id + '_fraction');
		this.constraints.push(`${coefficient} ${variable} - ${id}_grid - ${id}_plus + ${id}_minus = 0`);
		this.constraints.push(`${id}_plus + ${id}_minus - 0.5 ${id}_fraction <= 0`);
		this.objectiveTerms.push(`+ ${weight} ${id}_fraction + ${weight * 0.01} ${id}_plus + ${weight * 0.01} ${id}_minus`);
	}
}
