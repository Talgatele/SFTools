import '@angular/compiler';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {dirname} from 'node:path';
import ts from 'typescript';
import {of, firstValueFrom, Observable} from 'rxjs';
import {ProductionSolverService} from '../src/app/Model/Planner/ProductionSolverService.ts';
import {MachineGroupNormalizer} from '../src/app/Model/Planner/MachineGroupNormalizer.ts';
import {ExtraPowerResolver} from '../src/app/Model/Planner/ExtraPowerResolver.ts';
import {ExtraPower} from '../src/app/Model/Planner/ExtraPower.ts';
import {Item} from '../src/app/Model/Data/Entities/Item.ts';
import {preferSpaceElevatorRecipes, satisfactoryRecipeRate, satisfactoryTargets} from '../src/app/Model/Planner/SatisfactoryTargets.ts';
import {SubplanScaler} from '../src/app/Model/Planner/SubplanScaler.ts';
import {PlanLabelAssigner} from '../src/app/Model/Planner/PlanLabelAssigner.ts';
import {PlanIconResolver} from '../src/app/Model/Planner/PlanIconResolver.ts';
import {GraphEdgeBuilder} from '../src/app/Model/Planner/Graph/GraphEdgeBuilder.ts';
import {ProductNode} from '../src/app/Model/Planner/Solver/Response/ProductNode.ts';
import {ByproductNode} from '../src/app/Model/Planner/Solver/Response/ByproductNode.ts';
import {SpecialClasses} from '../src/app/Model/Planner/SpecialClasses.ts';
import {CalculatorProductionTabComponent} from '../src/app/Components/Planner/Panels/Calculator/Tabs/Production/CalculatorProductionTabComponent.ts';

// Exercise the worker's precision restoration as well as the real HiGHS engine.
// Unpatched HiGHS rounds to six significant figures and can make boundary cases infeasible.
const worker = readFileSync(new URL('../src/app/Model/Planner/Solver/Worker/SolverWorker.ts', import.meta.url), 'utf8');
const precisionSource = ts.transpileModule(worker.slice(0, worker.indexOf("addEventListener('message'")), {
	compilerOptions: {module: ts.ModuleKind.CommonJS},
}).outputText;
const {patchSolutionPrecision, restoreFullPrecisionPrimals} = new Function('exports', precisionSource
	+ ';return {patchSolutionPrecision, restoreFullPrecisionPrimals};')({});
const require = createRequire(import.meta.url);
const highsPath = require.resolve('highs');
const highsModule = {exports: {}};
new Function('module', 'exports', 'require', '__dirname', patchSolutionPrecision(readFileSync(highsPath, 'utf8')))(
	highsModule, highsModule.exports, require, dirname(highsPath));
const highs = await highsModule.exports();
const machine = {className: 'Constructor', manufacturingSpeed: 1, sloopSlots: 0, sloopBoost: 1,
	powerUsage: 4, powerUsageExponent: 1.6, fuel: []};
const itemNames = ['Concrete', 'Ore', 'Ingot', 'Rod', 'Plate', 'Screw', 'ReinforcedPlate', 'Rotor', 'Frame', 'Stator', 'Motor', 'Plastic', 'Desc_SpaceElevatorPart_1_C', 'Late1', 'Late2', 'Late3'];
const items = itemNames.map(className => Object.assign(Object.create(Item.prototype), {className, sinkPoints: 0, form: 'solid'}));
const item = name => items.find(item => item.className === name);
const quantities = values => Object.entries(values).map(([name, amount]) => ({item: item(name), amount}));
const recipe = (className, ingredients, products, alternate = false, time = 60) => ({className, name: className,
	ingredients: quantities(ingredients), products: quantities(products), alternate, producedIn: [machine], time});
const recipes = [
	recipe('Smelt', {Ore: 1}, {Ingot: 1}), recipe('Rods', {Ingot: 1}, {Rod: 1}),
	recipe('Plates', {Ingot: 3}, {Plate: 2}), recipe('Screws', {Rod: 1}, {Screw: 4}),
	recipe('ReinforcedPlates', {Plate: 6, Screw: 12}, {ReinforcedPlate: 1}),
	recipe('Rotors', {Rod: 5, Screw: 25}, {Rotor: 1}),
	recipe('Frames', {ReinforcedPlate: 3, Rod: 12}, {Frame: 2}),
	recipe('Stators', {Ingot: 3, Rod: 8}, {Stator: 1}),
	recipe('Motors', {Rotor: 2, Stator: 2}, {Motor: 1}),
	recipe('LateOne', {Motor: 1}, {Late1: 1}), recipe('LateTwo', {Late1: 1}, {Late2: 1}), recipe('LateThree', {Late2: 1}, {Late3: 1}),
	recipe('SmartPlating', {ReinforcedPlate: 1, Rotor: 1}, {Desc_SpaceElevatorPart_1_C: 1}, false, 30),
	recipe('PlasticSmartPlating', {ReinforcedPlate: 1, Rotor: 1, Plastic: 3}, {Desc_SpaceElevatorPart_1_C: 2}, true, 24),
];
const data = {items, resources: ['Ore', 'Plastic'], getRecipesForMachines: () => recipes,
	getItemByClassName: name => item(name), searchItemByClassName: name => item(name),
	getRecipeByClassName: name => recipes.find(recipe => recipe.className === name),
	getBuildingByClassName: () => machine, searchBuildingByClassName: () => undefined};
const selection = ['Screw', 'Rod', 'Plate', 'ReinforcedPlate', 'Rotor', 'Motor', 'Frame', 'Desc_SpaceElevatorPart_1_C'];
const plan = () => ({settings: {}, requests: selection.map(itemClassName => ({itemClassName, mode: 'satisfactory', ratePerMinute: 0}))});
const base = (limit = 720, enabled = recipes.filter(recipe => !recipe.alternate)) => ({
	optimisation: {rawResources: {Ore: 1, Plastic: 1}, power: 0, machines: 0, machineWeights: {}, wholeMachines: false, inputs: false}, maximise: null,
	recipes: enabled, productions: [], inputs: [], carryInputs: [], maxSloops: 0, defaultClockSpeed: 100,
	recipeClockSpeeds: {}, machineClockSpeeds: {}, generatorClockSpeeds: {}, resourceLimits: {Ore: limit, Plastic: 100},
	generators: [], extraPower: ExtraPower.NONE, powerDemand: 0, sinkPointsDemand: 0,
	producePowerForFactory: false, excessPowerFraction: 0, disabledByproducts: [], sinkableItems: [],
});
const solver = {solve: (lp, options) => {
	const solution = highs.solve(lp, {presolve: 'on', output_flag: false,
		mip_rel_gap: options?.workerOptions?.mipRelGap ?? 0.05,
		time_limit: options?.workerOptions?.timeLimitSeconds ?? Infinity});
	restoreFullPrecisionPrimals(solution);
	return of(solution);
}};
const service = solverOverride => new ProductionSolverService(solverOverride ?? solver, {}, new MachineGroupNormalizer(), {},
	{resolve: () => 'underclock-last'}, {}, {}, {}, {}, new ExtraPowerResolver());
const run = (p = plan(), request = base(), instance = service(), handle = {cancelled: false, cancelCurrent: null}) =>
	firstValueFrom(instance.solveMaximise(p, data, request, {category: 'items', satisfactory: true,
		items: [...new Set(p.requests.map(row => row.itemClassName))].map(item)}, [], handle));
const check = response => {
	assert.equal(response.status, 'Optimal');
	const ore = response.nodes.filter(node => node.type === 'mine' && node.item.className === 'Ore')
		.reduce((sum, node) => sum + node.amount, 0);
	assert.ok(ore <= 720.001, `ore used: ${ore}`);
	const balances = new Map();
	for (const node of response.nodes) {
		for (const io of node.outputs) balances.set(io.item.className, (balances.get(io.item.className) ?? 0) + io.maxAmount);
		for (const io of node.inputs) balances.set(io.item.className, (balances.get(io.item.className) ?? 0) - io.maxAmount);
	}
	for (const [name, balance] of balances) assert.ok(Math.abs(balance) < 0.001, `${name} balance: ${balance}`);
	return response.achievedMaximums;
};

test('selecting Power starts maximisation and enables fuels for a new power plan', () => {
	const component = Object.create(CalculatorProductionTabComponent.prototype);
	component.powerTargetClass = SpecialClasses.PowerTarget;
	const row = {itemClassName: '', mode: 'satisfactory', ratePerMinute: 0};
	component.rows = [row];
	let settings = {};
	component.planManager = {activeSettings: () => settings, updateActiveSettings: value => settings = value};
	component.versionManager = {activeVersionData: () => ({getPowerGenerators: () => [
		{className: 'CoalGenerator', fuel: [{item: {className: 'Coal'}}]},
	]})};
	let synced = 0;
	component.sync = () => synced++;
	component.onItemChange(row, SpecialClasses.PowerTarget);
	assert.equal(row.mode, 'maximise');
	assert.deepEqual(settings.enabledFuels, {CoalGenerator: ['Coal']});
	assert.equal(component.hasPowerTarget, true);
	assert.equal(synced, 1);

	// Selecting power again preserves an explicitly chosen rate and fuel configuration.
	row.mode = undefined;
	settings = {enabledFuels: {CoalGenerator: []}};
	component.onItemChange(row, SpecialClasses.PowerTarget);
	assert.equal(row.mode, undefined);
	assert.deepEqual(settings.enabledFuels, {CoalGenerator: []});
	row.itemClassName = 'Rod';
	component.onItemChange(row, SpecialClasses.PowerTarget);
	assert.deepEqual(settings.enabledFuels, {CoalGenerator: []});

	component.rows.push({itemClassName: 'Rod', mode: 'satisfactory', ratePerMinute: 0});
	row.itemClassName = '';
	component.onItemChange(row, SpecialClasses.PowerTarget);
	assert.equal(row.mode, 'satisfactory', 'power joins the automatic item requests');
	assert.equal(component.maximiseDisabled(row, 'maximise'), false);
	assert.equal(component.maximiseDisabled(component.rows[1], 'satisfactory-plus'), false);
	component.rows.push({itemClassName: SpecialClasses.SinkPointsTarget, mode: 'maximise', ratePerMinute: 0});
	component.sinkPointsTargetClass = SpecialClasses.SinkPointsTarget;
	assert.equal(component.maximiseDisabled(row), true, 'sink points remain a separate goal');
});

test('720 oil prioritises fuel power with useful plastic and rubber production, including Satisfactory+', async () => {
	const parts = ['Oil', 'Plastic', 'Rubber', 'HeavyOilResidue', 'Fuel'].map(className =>
		Object.assign(Object.create(Item.prototype), {className, name: className, sinkPoints: 0,
			form: ['Plastic', 'Rubber'].includes(className) ? 'solid' : 'liquid', energy: className === 'Fuel' ? 750 : 0}));
	const part = name => parts.find(item => item.className === name);
	const refinery = {...machine, className: 'Refinery', powerUsage: 30};
	const oilRecipe = (name, ingredients, products) => ({...recipe(name, {}, {}), producedIn: [refinery],
		ingredients: Object.entries(ingredients).map(([name, amount]) => ({item: part(name), amount})),
		products: Object.entries(products).map(([name, amount]) => ({item: part(name), amount}))});
	const oilRecipes = [oilRecipe('Plastic', {Oil: 30}, {Plastic: 20, HeavyOilResidue: 10}),
		oilRecipe('Rubber', {Oil: 30}, {Rubber: 20, HeavyOilResidue: 20}),
		oilRecipe('ResidualFuel', {HeavyOilResidue: 60}, {Fuel: 40}),
		oilRecipe('Fuel', {Oil: 60}, {Fuel: 40})];
	const fuel = {item: part('Fuel'), supplementalItem: null, byproduct: null, byproductAmount: 0};
	const generator = {className: 'FuelGenerator', name: 'Fuel-Powered Generator', powerProduction: 250,
		canOverclock: true, fuel: [fuel]};
	const oilData = {...data, items: parts, resources: ['Oil'], getRecipesForMachines: () => oilRecipes,
		getItemByClassName: part, searchItemByClassName: part,
		getRecipeByClassName: name => oilRecipes.find(recipe => recipe.className === name),
		getBuildingByClassName: name => name === generator.className ? generator : refinery};
	for (const [mode, customRate] of [['maximise'], ['satisfactory'], ['satisfactory-plus'], ['satisfactory-plus', 80]]) {
		const instance = service();
		const p = {settings: {}, requests: ['Plastic', 'Rubber'].map(itemClassName =>
			({itemClassName, mode, ratePerMinute: 0, ...(customRate === undefined ? {} : {satisfactoryOverride: customRate})}))};
		p.requests.push({itemClassName: SpecialClasses.PowerTarget,
			mode: mode === 'satisfactory-plus' ? mode : 'maximise', ratePerMinute: 0});
		const request = {...base(0, oilRecipes), resourceLimits: {Oil: 720},
			optimisation: {...base().optimisation, rawResources: {Oil: 1}, machines: 0.1},
			generators: [{generator, fuel, clockSpeed: 100}]};
		const result = await firstValueFrom(instance.solveMaximise(p, oilData, request, instance.maximiseTarget(p, oilData), []));
		assert.equal(result.status, 'Optimal', mode);
		assert.ok(Math.abs(result.achievedMaximums.Plastic - (customRate ?? 40)) < 0.001, mode);
		assert.ok(Math.abs(result.achievedMaximums.Rubber - (customRate ?? 40)) < 0.001, mode);
		const expectedPower = customRate === undefined ? 5500 : 5000;
		assert.ok(Math.abs(result.achievedMaximums[SpecialClasses.PowerTarget] - expectedPower) < 0.001,
			`${mode}: ${result.achievedMaximums[SpecialClasses.PowerTarget]}`);
		const generators = result.nodes.filter(node => node.type === 'generator');
		assert.equal(generators.length, 1);
		assert.ok(Math.abs(generators[0].amount - expectedPower / 250) < 0.001);
		assert.ok(result.nodes.filter(node => node.type === 'mine').reduce((sum, node) => sum + node.amount, 0) <= 720.001);
		const balances = new Map();
		for (const node of result.nodes) {
			for (const io of node.outputs) balances.set(io.item.className, (balances.get(io.item.className) ?? 0) + io.maxAmount);
			for (const io of node.inputs) balances.set(io.item.className, (balances.get(io.item.className) ?? 0) - io.maxAmount);
			if (mode === 'satisfactory-plus' && node.type === 'recipe') {
				assert.ok(node.groups.every(group => group.clockSpeed === 100 && Number.isInteger(group.machines)));
			}
		}
		for (const [name, balance] of balances) assert.ok(Math.abs(balance) < 0.001, `${mode}: ${name} = ${balance}`);
		assert.ok(new GraphEdgeBuilder().build(result.nodes).some(edge => edge.targetId === generators[0].id && edge.itemClassName === 'Fuel'));
	}
});

test('power maximisation respects both coal and water supply and builds connected generator nodes', async () => {
	const coal = Object.assign(Object.create(Item.prototype), {className: 'Coal', name: 'Coal', energy: 300, form: 'solid'});
	const water = Object.assign(Object.create(Item.prototype), {className: SpecialClasses.WaterItem, name: 'Water', form: 'liquid'});
	const fuel = {item: coal, supplementalItem: water, byproduct: null, byproductAmount: 0};
	const generator = {className: 'CoalGenerator', name: 'Coal-Powered Generator', powerProduction: 75,
		supplementalToPowerRatio: 10, canOverclock: true, fuel: [fuel]};
	const powerData = {...data, items: [coal, water], resources: ['Coal', water.className],
		getItemByClassName: name => name === 'Coal' ? coal : water,
		searchItemByClassName: name => [coal, water].find(item => item.className === name),
		getBuildingByClassName: () => generator, searchBuildingByClassName: () => generator};
	for (const [waterSupply, expectedPower, expectedCoal] of [[1440, 2400, 480], [1000, 1000 / 45 * 75, 1000 / 3]]) {
		const p = {settings: {enabledFuels: {CoalGenerator: ['Coal']}}, requests: [
			{itemClassName: SpecialClasses.PowerTarget, mode: 'maximise', ratePerMinute: 0},
		], inputs: [{itemClassName: 'Coal', amount: 480}, {itemClassName: water.className, amount: waterSupply}]};
		const instance = service();
		const request = {...base(0, []), resourceLimits: {Coal: 0, [water.className]: 0},
			inputs: instance.inputSources(p, powerData), generators: instance.enabledGenerators(p, powerData)};
		const result = await firstValueFrom(instance.solveMaximise(p, powerData, request,
			instance.maximiseTarget(p, powerData), []));
		assert.equal(result.status, 'Optimal');
		assert.ok(Math.abs(result.achievedMaximums[SpecialClasses.PowerTarget] - expectedPower) < 0.00001);
		const generators = result.nodes.filter(node => node.type === 'generator');
		assert.equal(generators.length, 1);
		assert.ok(Math.abs(generators[0].amount - expectedPower / 75) < 0.00001);
		assert.ok(Math.abs(generators[0].powerProduction() - expectedPower) < 0.00001);
		const edges = new GraphEdgeBuilder().build(result.nodes);
		assert.equal(edges.length, 2);
		assert.ok(edges.every(edge => edge.targetId === generators[0].id));
		assert.ok(Math.abs(edges.find(edge => edge.itemClassName === 'Coal').amount - expectedCoal) < 0.00001);
		assert.ok(Math.abs(edges.find(edge => edge.itemClassName === water.className).amount - waterSupply) < 0.00001);
	}
});

test('machine weights select the cheaper building and whole counting charges complete machines', async () => {
	const otherMachine = {...machine, className: 'Assembler'};
	const request = {...base(), recipes: [{...recipes[0], producedIn: [machine, otherMachine]}],
		productions: [{item: item('Ingot'), amount: 1.25}]};
	request.optimisation = {...request.optimisation, machines: 10, machineWeights: {Assembler: 1}};
	for (const wholeMachines of [false, true]) {
		request.optimisation.wholeMachines = wholeMachines;
		const solution = await firstValueFrom(solver.solve(service().buildLp(request, data)));
		assert.equal(solution.Status, 'Optimal');
		const values = new Map(Object.values(solution.Columns).map(column => [column.Name, column.Primal]));
		assert.equal(values.get('Smelt@Constructor%100#0'), 0);
		assert.equal(values.get('Smelt@Assembler%100#0'), 1.25);
		if (wholeMachines) assert.equal(values.get('Smelt@Assembler%100#0_count'), 2);
	}
});

test('Satisfactory refinement still balances production with upstream whole-machine objectives', async () => {
	const request = base();
	request.optimisation = {...request.optimisation, machines: 0.1, machineWeights: {Constructor: 0.2}, wholeMachines: true};
	const p = plan();
	p.requests.find(row => row.itemClassName === 'Motor').satisfactoryOverride = 3.25;
	const result = await run(p, request);
	const rates = check(result);
	assert.equal(rates.Motor, 3.25);
	assert.ok(rates.Desc_SpaceElevatorPart_1_C > 0);
});

test('Radio Control Units use supplied casings, computers and oscillators with mining disabled', async () => {
	const parts = ['Computer', 'AluminumCasing', 'AlcladAluminumSheet', 'CrystalOscillator', 'RadioControlUnit']
		.map(className => Object.assign(Object.create(Item.prototype), {className, sinkPoints: 0, form: 'solid'}));
	const part = name => parts.find(item => item.className === name);
	const radioRecipe = {...recipe('RadioControlUnits', {}, {}), time: 48,
		ingredients: [['AluminumCasing', 32], ['CrystalOscillator', 1], ['Computer', 2]]
			.map(([name, amount]) => ({item: part(name), amount})),
		products: [{item: part('RadioControlUnit'), amount: 2}]};
	const radioData = {...data, items: [...items, ...parts], getRecipesForMachines: () => [radioRecipe],
		getItemByClassName: name => part(name) ?? item(name), searchItemByClassName: name => part(name) ?? item(name),
		getRecipeByClassName: name => name === radioRecipe.className ? radioRecipe : undefined};
	const p = {...plan(), requests: [{itemClassName: 'RadioControlUnit', mode: 'satisfactory', ratePerMinute: 0}]};
	const request = {...base(0, [radioRecipe]), resourceLimits: {Ore: 0, Plastic: 0}};
	request.optimisation.inputs = true;
	const solveWith = aluminum => {
		request.inputs = [['Computer', 83.52], [aluminum, 2.66], ['CrystalOscillator', 30.72]]
			.map(([name, weight]) => ({item: part(name), amount: 100, weight}));
		return firstValueFrom(service().solveMaximise(p, radioData, request,
			{category: 'items', satisfactory: true, items: [part('RadioControlUnit')]}, []));
	};
	const missing = await solveWith('AlcladAluminumSheet');
	assert.equal(missing.status, 'Optimal');
	assert.equal(missing.achievedMaximums.RadioControlUnit, 0);
	assert.ok(!missing.nodes.some(node => node.type === 'recipe'));
	const supplied = await solveWith('AluminumCasing');
	assert.equal(supplied.status, 'Optimal');
	assert.ok(supplied.achievedMaximums.RadioControlUnit > 0);
	assert.ok(supplied.nodes.some(node => node.type === 'recipe' && node.recipe.className === 'RadioControlUnits'));
	assert.equal(supplied.nodes.filter(node => node.type === 'input').length, 3);
	assert.ok(!supplied.nodes.some(node => node.type === 'mine'));
	const casing = supplied.nodes.find(node => node.type === 'input' && node.item === part('AluminumCasing'));
	assert.ok(casing.amount <= 100);
	assert.ok(Math.abs(casing.amount - supplied.achievedMaximums.RadioControlUnit * 16) < 0.001);
});

test('720 ore: reserve recipe batches and maximise basic rates before simplifying the factory', async () => {
	const rates = check(await run());
	assert.equal(rates.Desc_SpaceElevatorPart_1_C, 4);
	assert.equal(rates.Frame, 10);
	assert.equal(rates.Motor, 5);
	for (const name of ['Screw', 'Rod', 'Plate']) {
		assert.ok(rates[name] > 0);
	}
});

const withoutRefinement = {solve: (lp, options) => {
	if (lp.includes('sf_')) return of({Status: 'Infeasible', Columns: {}});
	return solver.solve(lp, options);
}};

test('manifold refinement cleans real iron-chain flows within 2% of each baseline output', async () => {
	const times = {Smelt: 2, Rods: 4, Plates: 6, Screws: 6, ReinforcedPlates: 12,
		Rotors: 15, Frames: 60, SmartPlating: 30};
	const realRecipes = recipes.filter(recipe => times[recipe.className]).map(recipe => ({...recipe, time: times[recipe.className]}));
	const realData = {...data, getRecipesForMachines: () => realRecipes,
		getRecipeByClassName: name => realRecipes.find(recipe => recipe.className === name)};
	const p = plan();
	p.requests = p.requests.filter(row => row.itemClassName !== 'Motor');
	p.requests.find(row => row.itemClassName === 'ReinforcedPlate').satisfactoryOverride = 15;
	const request = base(720, realRecipes);
	const solve = instance => firstValueFrom(instance.solveMaximise(p, realData, request,
		{category: 'items', satisfactory: true, items: p.requests.map(row => item(row.itemClassName))}, []));
	const original = await solve(service(withoutRefinement));
	const refined = await solve(service());
	check(refined);
	for (const row of p.requests) {
		const name = row.itemClassName;
		assert.ok(refined.achievedMaximums[name] >= original.achievedMaximums[name] * 0.98 - 1e-6, name);
	}
	assert.equal(refined.achievedMaximums.ReinforcedPlate, 15);
	const machineCount = response => response.nodes.filter(node => node.type === 'recipe').reduce((sum, node) => sum + node.amount, 0);
	assert.ok(machineCount(refined) <= machineCount(original) + 2);
	const internal = response => response.nodes.filter(node => node.type === 'recipe')
		.flatMap(node => [...node.inputs, ...node.outputs].map(io => io.maxAmount));
	const fractional = rates => rates.filter(rate => Math.abs(rate - Math.round(rate)) > 1e-5).length;
	assert.ok(fractional(internal(refined)) < fractional(internal(original)));
	const edges = new GraphEdgeBuilder().build(refined.nodes);
	assert.ok(edges.every(edge => Math.abs(edge.amount * 10 - Math.round(edge.amount * 10)) < 1e-4));
});

test('optional simplification failures preserve the original factory and exact custom targets', async () => {
	const p = plan();
	p.requests[0].satisfactoryOverride = 15.125;
	const baseline = await run(p, base(), service(withoutRefinement));
	const failed = {solve: (lp, options) => {
		if (lp.includes('sf_')) return new Observable(subscriber => subscriber.error(new Error('Refinement timed out')));
		return solver.solve(lp, options);
	}};
	const result = await run(p, base(), service(failed));
	assert.deepEqual(check(result), check(baseline));
	assert.equal(result.achievedMaximums.Screw, 15.125);
});

test('fractional final output is preferred when it makes upstream production whole', async () => {
	const realRecipes = [recipe('Smelt', {Ore: 3}, {Ingot: 2}), recipe('Rods', {Ingot: 1}, {Rod: 1})];
	const realData = {...data, getRecipesForMachines: () => realRecipes,
		getRecipeByClassName: name => realRecipes.find(recipe => recipe.className === name)};
	const p = {...plan(), requests: [
		{itemClassName: 'Ingot', mode: 'satisfactory', ratePerMinute: 0},
		{itemClassName: 'Rod', mode: 'satisfactory', ratePerMinute: 0, satisfactoryOverride: 15.125},
	]};
	const result = await firstValueFrom(service().solveMaximise(p, realData, base(66, realRecipes),
		{category: 'items', satisfactory: true, items: [item('Ingot'), item('Rod')]}, []));
	check(result);
	assert.ok(Math.abs(result.achievedMaximums.Ingot - 28.875) < 1e-6);
	assert.equal(result.achievedMaximums.Rod, 15.125);
	assert.equal(result.nodes.find(node => node.type === 'mine').amount, 66);
	assert.equal(result.nodes.find(node => node.type === 'recipe' && node.recipe.className === 'Smelt').outputs[0].maxAmount, 44);
});

test('cancellation during simplification terminates its worker subscription', async () => {
	let cancelled = false;
	let subscription;
	await new Promise((resolve, reject) => {
		const hanging = {solve: (lp, options) => {
			if (lp.includes('sf_')) return new Observable(() => {
				queueMicrotask(() => {subscription.unsubscribe(); resolve();});
				return () => {cancelled = true;};
			});
			return solver.solve(lp, options);
		}};
		subscription = service(hanging).solveMaximise(plan(), data, base(),
			{category: 'items', satisfactory: true, items: selection.map(item)}, []).subscribe({error: reject});
	});
	assert.equal(cancelled, true);
});

test('custom 15/min stays fixed, advanced targets persist, basic rates recalculate, reset restores defaults', async () => {
	const before = check(await run());
	const p = plan();
	p.requests.find(row => row.itemClassName === 'ReinforcedPlate').satisfactoryOverride = 15;
	const rates = check(await run(p));
	assert.equal(rates.ReinforcedPlate, 15);
	assert.equal(rates.Desc_SpaceElevatorPart_1_C, 4);
	assert.equal(rates.Frame, 10);
	assert.ok(rates.Rod < before.Rod);
	const restored = JSON.parse(JSON.stringify(p));
	assert.equal(check(await run(restored)).ReinforcedPlate, 15);
	delete restored.requests.find(row => row.itemClassName === 'ReinforcedPlate').satisfactoryOverride;
	assert.deepEqual(check(await run(restored)), before);
});

test('an explicitly disabled standard recipe allows alternate elevator throughput', async () => {
	const enabled = recipes.filter(recipe => recipe.className !== 'SmartPlating');
	const rates = check(await run(plan(), base(720, enabled)));
	assert.equal(rates.Desc_SpaceElevatorPart_1_C, 10);
});

test('short resources reduce automatic targets; impossible custom targets fail', async () => {
	const response = await run(plan(), base(10));
	assert.equal(response.status, 'Optimal');
	assert.ok(response.achievedMaximums.Desc_SpaceElevatorPart_1_C < 4);
	const p = plan();
	p.requests[0].satisfactoryOverride = 100000;
	assert.notEqual((await run(p)).status, 'Optimal');
});

test('zero is a custom rate and input order does not change allocation', async () => {
	const p = plan();
	p.requests[0].satisfactoryOverride = 0;
	assert.equal(check(await run(p)).Screw, 0);
	const reversed = plan();
	reversed.requests.reverse();
	assert.deepEqual(check(await run(reversed)), check(await run()));
});

test('rounding retains sub-0.1 maxima and prefers whole, half and one-decimal rates', () => {
	const s = service();
	assert.equal(s.cleanProductionRate(12.2), 12);
	assert.equal(s.cleanProductionRate(12.58), 12.5);
	assert.equal(s.cleanProductionRate(12.89), 12.8);
	assert.equal(s.cleanProductionRate(0.0375), 0.0375);
});

test('hierarchy tolerates recycling loops and gives basic materials uncapped targets', () => {
	const loop = recipe('Recycle', {Frame: 1}, {Ingot: 1});
	const targets = satisfactoryTargets({...data, getRecipesForMachines: () => [...recipes, loop]}, [...recipes, loop], items);
	assert.equal(targets.find(target => target.item === item('Screw')).rate, null);
	assert.equal(targets.find(target => target.item === item('Frame')).rate, 10);
	assert.equal(targets.find(target => target.item === item('Late2')).rate, 2);
	assert.equal(targets.find(target => target.item === item('Late3')).rate, 2);
});

test('an unavailable intermediate does not prevent other requested items being produced', async () => {
	const enabled = recipes.filter(recipe => !recipe.alternate && recipe.className !== 'Motors');
	const rates = check(await run(plan(), base(720, enabled)));
	assert.equal(rates.Motor, 0);
	assert.equal(rates.Desc_SpaceElevatorPart_1_C, 4);
	assert.ok(rates.Rod > 0);
});

test('custom-only plans preserve exact decimals; invalid saved overrides are rejected', async () => {
	const p = plan();
	p.requests = [{itemClassName: 'Rod', mode: 'satisfactory', ratePerMinute: 0, satisfactoryOverride: 15.125}];
	assert.equal(check(await run(p)).Rod, 15.125);
	p.requests[0].satisfactoryOverride = -1;
	await assert.rejects(run(p), /non-negative/);
});

test('cancelling the multi-stage solve cancels the active worker subscription', () => {
	let cancelled = false;
	const instance = service({solve: () => new Observable(() => () => {cancelled = true;})});
	const subscription = instance.solveMaximise(plan(), data, base(), {category: 'items', satisfactory: true,
		items: selection.map(item)}, []).subscribe();
	subscription.unsubscribe();
	assert.equal(cancelled, true);
});

test('scaling a subplan scales custom rates while keeping automatic rows automatic', () => {
	const p = plan();
	p.inputs = [];
	p.requests[0].satisfactoryOverride = 15;
	let scaled;
	const scaler = new SubplanScaler({isReadOnlyPlan: () => false, findPlan: () => p,
		setRequests: (_id, rows) => {scaled = rows;}, setInputs: () => {}}, {}, {}, {}, {});
	scaler.scale('plan', 2);
	assert.equal(scaled[0].satisfactoryOverride, 30);
	assert.equal(scaled[1].satisfactoryOverride, undefined);
});

test('seven requested items and 720 iron use standard Smart Plating even with alternates enabled', async () => {
	const p = plan();
	p.requests = p.requests.filter(row => row.itemClassName !== 'Motor');
	const request = base(720, recipes);
	request.resourceLimits.Plastic = 0;
	const response = await run(p, request);
	const rates = check(response);
	assert.equal(rates.Desc_SpaceElevatorPart_1_C, 4);
	assert.equal(rates.Frame, 10);
	assert.ok(response.nodes.some(node => node.type === 'recipe' && node.recipe.className === 'SmartPlating'));
	assert.ok(!response.nodes.some(node => node.type === 'recipe' && node.recipe.className === 'PlasticSmartPlating'));
	for (const name of ['Screw', 'Rod', 'Plate']) assert.ok(rates[name] > 4);
});

test('standard elevator preference also applies to Versatile Framework and preserves other alternates', () => {
	const framework = {className: 'Desc_SpaceElevatorPart_2_C'};
	const standard = {...recipes[0], className: 'Framework', time: 24, products: [{item: framework, amount: 2}]};
	const alternate = {...standard, className: 'FlexibleFramework', alternate: true};
	const screws = {...recipes[3], className: 'CastScrews', alternate: true};
	assert.deepEqual(preferSpaceElevatorRecipes([standard, alternate, screws]), [standard, screws]);
	assert.deepEqual(preferSpaceElevatorRecipes([alternate, screws]), [alternate, screws]);
	assert.equal(satisfactoryRecipeRate(standard, framework, 2), 10);
});

const labelFixture = (outputs = []) => {
	const versions = {activeVersionData: () => ({...data, iconForClassName: name => 'icon:' + name})};
	const labels = new PlanLabelAssigner(versions, {resolve: () => ({outputs})});
	return {labels, icons: new PlanIconResolver(versions, labels)};
};
const labelledPlan = () => ({...plan(), name: 'My factory', autoName: false, autoIcon: true, iconClassName: 'Screw'});

test('automatic icons choose Space Elevator parts regardless of request order', () => {
	const {labels} = labelFixture();
	const p = labelledPlan();
	assert.equal(labels.assign(p).iconClassName, 'Desc_SpaceElevatorPart_1_C');
	p.requests.reverse();
	assert.equal(labels.generatedIcon(p), 'Desc_SpaceElevatorPart_1_C');
	assert.equal(labels.assign(p).name, 'My factory');
});

test('without an elevator part the highest production depth supplies the icon', () => {
	const {labels} = labelFixture();
	const p = labelledPlan();
	p.requests = p.requests.filter(row => row.itemClassName !== 'Desc_SpaceElevatorPart_1_C');
	// Frame and Motor share a depth in this fixture; ties use stable class-name order.
	assert.equal(labels.assign(p).iconClassName, 'Frame');
	p.requests.push({itemClassName: 'Late1', mode: 'satisfactory', ratePerMinute: 0});
	assert.equal(labels.assign(p).iconClassName, 'Late1');
});

test('automatic icons fall back to graph outputs in manually built plans', () => {
	const {labels} = labelFixture([{item: item('Rod')}, {item: item('Frame')}]);
	const p = {...labelledPlan(), requests: []};
	assert.equal(labels.assign(p).iconClassName, 'Frame');
	assert.equal(labelFixture().labels.generatedIcon(p), null);
});

test('manual icons, including no icon, are preserved; old automatic icons refresh immediately', () => {
	const {labels, icons} = labelFixture();
	const p = labelledPlan();
	assert.equal(icons.iconHash(p), 'icon:Desc_SpaceElevatorPart_1_C');
	assert.equal(labels.assign({...p, autoIcon: false}).iconClassName, 'Screw');
	assert.equal(icons.iconHash({...p, autoIcon: false, iconClassName: null}), null);
	const legacy = {...p, autoIcon: undefined};
	assert.equal(labels.assign(legacy).autoIcon, true);
	assert.equal(icons.iconHash(legacy), 'icon:Desc_SpaceElevatorPart_1_C');
	assert.equal(labels.assign({...legacy, iconClassName: 'Plastic'}).autoIcon, false);
	const assigned = labels.assign(p);
	assert.equal(labels.assign(assigned), assigned);
});


test('Satisfactory+ keeps every production machine at 100% despite clock overrides', async () => {
	const p = plan();
	p.requests.forEach(row => row.mode = 'satisfactory-plus');
	const request = {...base(719.5), defaultClockSpeed: 175,
		recipeClockSpeeds: {Smelt: 250}, machineClockSpeeds: {Constructor: 50}};
	const response = await run(p, request);
	check(response);
	const machines = response.nodes.filter(node => node.type === 'recipe');
	assert.ok(machines.length > 0);
	for (const node of machines) {
		assert.ok(Number.isInteger(node.target), `${node.recipe.className}: ${node.target}`);
		for (const group of node.groups) {
			assert.equal(group.clockSpeed, 100);
			assert.ok(Number.isInteger(group.machines));
		}
	}
	assert.ok(response.achievedMaximums.Motor > 0);
});

test('Satisfactory+ preserves exact custom outputs using whole machines', async () => {
	const p = {...plan(), requests: [{itemClassName: 'Rod', mode: 'satisfactory-plus',
		ratePerMinute: 0, satisfactoryOverride: 15.125}]};
	const response = await run(p);
	check(response);
	assert.equal(p.requests[0].satisfactoryOverride, 15.125);
	assert.equal(response.achievedMaximums.Rod, 16);
	assert.equal(response.nodes.find(node => node.type === 'product' && node.item.className === 'Rod').amount, 16);
	assert.ok(!response.nodes.some(node => node.type === 'byproduct' && node.item.className === 'Rod'));
	for (const node of response.nodes.filter(node => node.type === 'recipe')) {
		assert.ok(Number.isInteger(node.target));
		assert.ok(node.groups.every(group => group.clockSpeed === 100));
	}
});

test('Satisfactory+ is detected and scales custom rates', () => {
	const p = {...plan(), requests: [{itemClassName: 'Rod', mode: 'satisfactory-plus',
		ratePerMinute: 0, satisfactoryOverride: 15.125}]};
	assert.equal(service().maximiseTarget(p, data).satisfactory, true);
	p.inputs = [];
	let scaled;
	const scaler = new SubplanScaler({isReadOnlyPlan: () => false, findPlan: () => p,
		setRequests: (_id, rows) => {scaled = rows;}, setInputs: () => {}}, {}, {}, {}, {});
	scaler.scale('plan', 2);
	assert.equal(scaled[0].satisfactoryOverride, 30.25);
});


test('Satisfactory+ rejects overclocked locked machines', async () => {
	const p = plan();
	p.requests.forEach(row => row.mode = 'satisfactory-plus');
	const response = await run(p);
	const node = response.nodes.find(node => node.type === 'recipe');
	node.groups[0] = {...node.groups[0], clockSpeed: 150};
	assert.throws(() => service().solveMaximise(p, data, base(),
		{category: 'items', satisfactory: true, items: selection.map(item)}, [node]), /locked machine/);
});


test('Satisfactory+ power uses whole generators at 100% with limited water', async () => {
	const coal = Object.assign(Object.create(Item.prototype), {className: 'Coal', energy: 300, form: 'solid'});
	const water = Object.assign(Object.create(Item.prototype), {className: SpecialClasses.WaterItem, form: 'liquid'});
	const fuel = {item: coal, supplementalItem: water, byproduct: null, byproductAmount: 0};
	const generator = {className: 'CoalGenerator', powerProduction: 75,
		supplementalToPowerRatio: 10, canOverclock: true, fuel: [fuel]};
	const powerData = {...data, items: [coal, water], resources: ['Coal', water.className],
		getItemByClassName: name => name === 'Coal' ? coal : water,
		searchItemByClassName: name => [coal, water].find(item => item.className === name),
		getBuildingByClassName: () => generator};
	const p = {settings: {}, requests: [{itemClassName: SpecialClasses.PowerTarget,
		mode: 'satisfactory-plus', ratePerMinute: 0}]};
	const instance = service();
	const request = {...base(0, []), resourceLimits: {Coal: 480, [water.className]: 1000},
		generators: [{generator, fuel, clockSpeed: 250}]};
	const response = await firstValueFrom(instance.solveMaximise(p, powerData, request,
		instance.maximiseTarget(p, powerData), []));
	assert.equal(response.status, 'Optimal');
	const generators = response.nodes.filter(node => node.type === 'generator');
	assert.equal(generators.length, 1);
	assert.equal(generators[0].clockSpeed, 100);
	assert.equal(generators[0].amount, 22);
	assert.equal(response.achievedMaximums[SpecialClasses.PowerTarget], 1650);
});


test('switching to Satisfactory+ updates existing automatic rows together', () => {
	const component = Object.create(CalculatorProductionTabComponent.prototype);
	component.rows = [
		{itemClassName: 'Rod', mode: 'satisfactory', ratePerMinute: 0},
		{itemClassName: 'Plate', mode: 'satisfactory', ratePerMinute: 0, satisfactoryOverride: 10},
	];
	component.sync = () => {};
	assert.equal(component.maximiseDisabled(component.rows[0], 'satisfactory-plus'), false);
	component.setMode(component.rows[0], 'satisfactory-plus');
	assert.ok(component.rows.every(row => row.mode === 'satisfactory-plus'));
	assert.equal(component.rows[1].satisfactoryOverride, 10);
});


test('requested surplus joins green products, including zero targets, while other byproducts remain', () => {
	const p = {requests: [{itemClassName: 'Plate'}, {itemClassName: 'Rotor'}]};
	const result = service().rollUpRequestedSurplus({status: 'Optimal', achievedMaximums: {Plate: 88.7, Rotor: 0}, nodes: [
		new ProductNode('plate', 88.7, item('Plate')),
		new ByproductNode('plate-extra', 0.05, item('Plate')),
		new ByproductNode('rotor-extra', 2.25, item('Rotor')),
		new ByproductNode('ingot-extra', 10, item('Ingot')),
	]}, p);
	assert.equal(result.nodes.length, 3);
	assert.equal(result.nodes.find(node => node.id === 'plate').amount, 88.75);
	assert.equal(result.nodes.find(node => node.item.className === 'Rotor').type, 'product');
	assert.equal(result.nodes.find(node => node.item.className === 'Ingot').type, 'byproduct');
	assert.deepEqual(result.achievedMaximums, {Plate: 88.75, Rotor: 2.25});
	assert.deepEqual(service().rollUpRequestedSurplus(result, p), result);
});


test('Satisfactory+ underclocks unrequested intermediates and their supply instead of leaving byproducts', async () => {
	const chain = [
		recipe('Smelt', {Ore: 30}, {Ingot: 30}),
		recipe('Rods', {Ingot: 15}, {Rod: 15}),
		recipe('Plates', {Ingot: 30}, {Plate: 20}),
		recipe('Screws', {Rod: 10}, {Screw: 40}),
		recipe('ReinforcedPlates', {Plate: 30, Screw: 60}, {ReinforcedPlate: 5}),
		recipe('Concrete', {Ore: 45}, {Concrete: 15}),
		recipe('Frames', {ReinforcedPlate: 2, Concrete: 40}, {Frame: 2}),
	];
	const chainData = {...data, getRecipesForMachines: () => chain,
		getRecipeByClassName: name => chain.find(recipe => recipe.className === name)};
	const p = {settings: {}, requests: [{itemClassName: 'Frame', mode: 'satisfactory-plus',
		ratePerMinute: 0, satisfactoryOverride: 2}]};
	// Even a no-clocking display preference must not recreate the surplus we just removed.
	const instance = service();
	instance.groupingModes = {resolve: () => 'no-clocking'};
	const result = await firstValueFrom(instance.solveMaximise(p, chainData, base(300, chain),
		{category: 'items', satisfactory: true, items: [item('Frame')]}, []));
	check(result);
	assert.equal(result.achievedMaximums.Frame, 2);
	assert.ok(!result.nodes.some(node => node.type === 'byproduct'));
	assert.equal(result.nodes.find(node => node.type === 'mine').amount, 144);
	const reinforced = result.nodes.find(node => node.type === 'recipe' && node.recipe.className === 'ReinforcedPlates');
	assert.equal(reinforced.target, 0.4);
	assert.deepEqual(reinforced.groups, [{machines: 1, clockSpeed: 40, sloops: 0}]);
	const concrete = result.nodes.find(node => node.type === 'recipe' && node.recipe.className === 'Concrete');
	assert.ok(Math.abs(concrete.target - 40 / 15) < 1e-8);
	assert.equal(concrete.groups[0].machines, 2);
	assert.equal(concrete.groups[0].clockSpeed, 100);
	assert.equal(concrete.groups[1].clockSpeed, 66.6667);
	const frame = result.nodes.find(node => node.type === 'recipe' && node.recipe.className === 'Frames');
	assert.deepEqual(frame.groups, [{machines: 1, clockSpeed: 100, sloops: 0}]);
});


test('Satisfactory+ retains unavoidable co-products rather than hiding or discarding them', async () => {
	const coProduct = recipe('Frames', {Ore: 1}, {Frame: 2, Concrete: 3});
	const chainData = {...data, getRecipesForMachines: () => [coProduct], getRecipeByClassName: () => coProduct};
	const p = {settings: {}, requests: [{itemClassName: 'Frame', mode: 'satisfactory-plus',
		ratePerMinute: 0, satisfactoryOverride: 2}]};
	const result = await firstValueFrom(service().solveMaximise(p, chainData, base(300, [coProduct]),
		{category: 'items', satisfactory: true, items: [item('Frame')]}, []));
	check(result);
	assert.equal(result.achievedMaximums.Frame, 2);
	assert.equal(result.nodes.find(node => node.type === 'byproduct').amount, 3);
	assert.equal(result.nodes.find(node => node.type === 'recipe').target, 1);
});


test('Steel Beam factory allocates freed intermediate capacity before fixing requested outputs', async () => {
	const fixture = JSON.parse(readFileSync(new URL('./fixtures/steel-beam-factory.json', import.meta.url), 'utf8'));
	const parts = new Map(Object.entries(fixture.items).map(([className, name]) => [className,
		Object.assign(Object.create(Item.prototype), {className, name, form: 'solid', sinkPoints: 0})]));
	const hydrate = values => values.map(value => ({...value, item: parts.get(value.item)}));
	const chain = fixture.recipes.map(recipe => ({...recipe, alternate: false, producedIn: [machine],
		ingredients: hydrate(recipe.ingredients), products: hydrate(recipe.products)}));
	const chainData = {items: [...parts.values()], resources: Object.keys(fixture.resourceLimits),
		getRecipesForMachines: () => chain, getItemByClassName: name => parts.get(name),
		searchItemByClassName: name => parts.get(name),
		getRecipeByClassName: name => chain.find(recipe => recipe.className === name),
		getBuildingByClassName: () => machine, searchBuildingByClassName: () => undefined};
	const p = {settings: {}, requests: fixture.requests.map(itemClassName =>
		({itemClassName, mode: 'satisfactory-plus', ratePerMinute: 0}))};
	const request = {...base(480, chain), resourceLimits: fixture.resourceLimits,
		optimisation: {...base().optimisation, rawResources: Object.fromEntries(chainData.resources.map(name => [name, 1]))}};
	const response = await firstValueFrom(service().solveMaximise(p, chainData, request,
		{category: 'items', satisfactory: true, items: fixture.requests.map(name => parts.get(name))}, []));
	check(response);
	assert.equal(response.achievedMaximums.Desc_SteelPlate_C, 15);
	assert.equal(response.achievedMaximums.Desc_SteelPipe_C, 25);
	assert.equal(response.achievedMaximums.Desc_SpaceElevatorPart_2_C, 10);
	assert.equal(response.achievedMaximums.Desc_SpaceElevatorPart_3_C, 5);
	assert.ok(!response.nodes.some(node => node.type === 'byproduct'));
	for (const node of response.nodes.filter(node => node.type === 'mine')) {
		assert.ok(node.amount <= fixture.resourceLimits[node.item.className] + 1e-5);
	}
	const beams = response.nodes.find(node => node.type === 'recipe' && node.recipe.className === 'Recipe_SteelBeam_C');
	assert.deepEqual(beams.groups, [{machines: 5, clockSpeed: 100, sloops: 0}]);
});
