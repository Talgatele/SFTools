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
const itemNames = ['Ore', 'Ingot', 'Rod', 'Plate', 'Screw', 'ReinforcedPlate', 'Rotor', 'Frame', 'Stator', 'Motor', 'Plastic', 'Desc_SpaceElevatorPart_1_C', 'Late1', 'Late2', 'Late3'];
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
	optimisation: {rawResources: {Ore: 1, Plastic: 1}, power: 0, machines: 0, inputs: false}, maximise: null,
	recipes: enabled, productions: [], inputs: [], carryInputs: [], maxSloops: 0, defaultClockSpeed: 100,
	recipeClockSpeeds: {}, machineClockSpeeds: {}, generatorClockSpeeds: {}, resourceLimits: {Ore: limit, Plastic: 100},
	generators: [], extraPower: ExtraPower.NONE, powerDemand: 0, sinkPointsDemand: 0,
	producePowerForFactory: false, excessPowerFraction: 0, disabledByproducts: [], sinkableItems: [],
});
const solver = {solve: lp => {
	const solution = highs.solve(lp, {presolve: 'on', output_flag: false});
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

test('720 ore: reserve recipe batches and maximise clean basic rates', async () => {
	const rates = check(await run());
	assert.equal(rates.Desc_SpaceElevatorPart_1_C, 4);
	assert.equal(rates.Frame, 10);
	assert.equal(rates.Motor, 5);
	for (const name of ['Screw', 'Rod', 'Plate']) {
		assert.ok(rates[name] > 0);
		assert.ok(Math.abs(rates[name] * 10 - Math.round(rates[name] * 10)) < 1e-8);
	}
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
