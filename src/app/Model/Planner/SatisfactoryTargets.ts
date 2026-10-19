import {Data} from '@src/Model/Data/Data';
import {Item} from '@src/Model/Data/Entities/Item';
import {Recipe} from '@src/Model/Data/Entities/Recipe';
import {Formulas} from '@src/Model/Planner/Formulas';

export function isSpaceElevatorPart(item: Item): boolean
{
	return /^Desc_SpaceElevatorPart_\d+_C$/.test(item.className);
}

/** Prefer enabled standard Project Assembly recipes, without enabling a disabled recipe. */
export function preferSpaceElevatorRecipes(recipes: Recipe[]): Recipe[]
{
	const standard = new Set(recipes.filter(recipe => !recipe.alternate)
		.flatMap(recipe => recipe.products.filter(product => product.item && isSpaceElevatorPart(product.item))
			.map(product => product.item.className)));
	return recipes.filter(recipe => !recipe.alternate || !recipe.products.some(product => product.item
		&& isSpaceElevatorPart(product.item) && standard.has(product.item.className)));
}

export function satisfactoryRecipeRate(recipe: Recipe, item: Item, multiplier: number): number
{
	const output = recipe.products.find(product => product.item === item)?.amount ?? 1;
	// Elevator targets represent two standard machines at 100%: Smart Plating is 4/min.
	const cycles = isSpaceElevatorPart(item) && recipe.producedIn[0]
		? Formulas.referenceCycles(recipe, recipe.producedIn[0]) : 1;
	return multiplier * output * cycles;
}

export interface SatisfactoryTarget
{
	item: Item;
	depth: number;
	/** null means use all remaining resources. */
	rate: number | null;
	multiplier: number;
}

const hierarchyCache = new WeakMap<Data, ReadonlyMap<string, number>>();

/** Shared by production targets and automatic plan icons; Data is immutable per version. */
export function productionDepths(data: Data): ReadonlyMap<string, number>
{
	const cached = hierarchyCache.get(data);
	if (cached) return cached;
	// Use the game's standard production hierarchy even when a shortcut alternate is enabled.
	// Relaxing shortest paths handles recycling loops without recursion or inflated tiers.
	const hierarchy = data.getRecipesForMachines().filter(recipe => !recipe.alternate);
	const produced = new Set(hierarchy.flatMap(recipe => recipe.products.filter(p => p.item).map(p => p.item.className)));
	const depths = new Map(data.items.filter(item => !produced.has(item.className) || data.resources.includes(item.className))
		.map(item => [item.className, 0]));
	for (let pass = 0; pass < data.items.length; pass++) {
		let changed = false;
		for (const recipe of hierarchy) {
			if (recipe.ingredients.some(ingredient => !ingredient.item || !depths.has(ingredient.item.className))) continue;
			const depth = 1 + Math.max(0, ...recipe.ingredients.map(ingredient => depths.get(ingredient.item.className)!));
			for (const product of recipe.products) {
				if (product.item && depth < (depths.get(product.item.className) ?? Infinity)) {
					depths.set(product.item.className, depth);
					changed = true;
				}
			}
		}
		if (!changed) break;
	}
	hierarchyCache.set(data, depths);
	return depths;
}

/** Modest elevator throughput, intermediate recipe batches and abundant basic materials. */
export function satisfactoryTargets(data: Data, recipes: Recipe[], items: Item[]): SatisfactoryTarget[]
{
	const byProduct = new Map<string, Recipe[]>();
	for (const recipe of recipes) {
		for (const product of recipe.products) {
			if (product.item && product.amount > 0) {
				byProduct.set(product.item.className, [...(byProduct.get(product.item.className) ?? []), recipe]);
			}
		}
	}
	const depths = productionDepths(data);
	const topDepth = Math.max(0, ...depths.values());
	return items.map(item => {
		const candidates = [...(byProduct.get(item.className) ?? [])].sort((a, b) =>
			Number(a.alternate) - Number(b.alternate) || a.className.localeCompare(b.className));
		const recipe = candidates[0];
		const depth = depths.get(item.className) ?? topDepth;
		// The data contract has no Space Elevator category. These stable game class IDs
		// cover all Project Assembly parts, independently of translated display names.
		const elevator = isSpaceElevatorPart(item);
		const basic = !elevator && (depth <= 2 || (recipe?.ingredients.length === 1
			&& (depths.get(recipe.ingredients[0].item?.className) ?? Infinity) <= 2));
		const multiplier = elevator || (depth > 4 && depth >= topDepth - 1) ? 2 : 5;
		return {item, depth, multiplier, rate: basic ? null : recipe ? satisfactoryRecipeRate(recipe, item, multiplier) : multiplier};
	}).sort((a, b) => Number(b.multiplier === 2) - Number(a.multiplier === 2)
		|| b.depth - a.depth || a.item.className.localeCompare(b.item.className));
}
