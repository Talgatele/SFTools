import assert from 'node:assert/strict';
import {performance} from 'node:perf_hooks';
import {graphFixture, baselineClass} from './performance-fixtures.mjs';
import {GraphEdgeBuilder} from '../src/app/Model/Planner/Graph/GraphEdgeBuilder.ts';
import {GraphReconciler} from '../src/app/Model/Planner/Graph/GraphReconciler.ts';
import {GraphComposer} from '../src/app/Model/Planner/Graph/GraphComposer.ts';
import {ProductionSolverService} from '../src/app/Model/Planner/ProductionSolverService.ts';
import {ExtraPower} from '../src/app/Model/Planner/ExtraPower.ts';

const ref = process.argv[2] ?? 'e4432f337aab5a38489bcd4d9c02d4a3fe47a5c1';
const OldBuilder = baselineClass('src/app/Model/Planner/Graph/GraphEdgeBuilder.ts', 'GraphEdgeBuilder', ref);
const OldReconciler = baselineClass('src/app/Model/Planner/Graph/GraphReconciler.ts', 'GraphReconciler', ref);
const OldComposer = baselineClass('src/app/Model/Planner/Graph/GraphComposer.ts', 'GraphComposer', ref);
const medianMs = fn => {
	for (let i = 0; i < 5; i++) fn();
	const samples = [];
	for (let i = 0; i < 15; i++) {
		global.gc?.();
		const start = performance.now();
		fn();
		samples.push(performance.now() - start);
	}
	return samples.sort((a, b) => a - b)[7];
};
console.log(`Baseline: ${ref}; Node ${process.version}; medians of 15 runs after 5 warmups`);
for (const count of [100, 1000, 5000]) {
	const graph = graphFixture(count);
	// Deliberate parallel edges and a deficit exercise aggregation as well as the balanced case.
	graph.edges[0].amount = 3;
	graph.edges.push({...graph.edges[0], amount: 4});
	for (const [name, Before, After, method, args] of [
		['preserve edges', OldBuilder, GraphEdgeBuilder, 'build', [graph.nodes, graph.edges]],
		['warnings', OldReconciler, GraphReconciler, 'computeWarnings', [graph]],
		['restore routing', OldComposer, GraphComposer, 'withPriorRouting', [graph.edges, graph.edges]],
	]) {
		const before = new Before(), after = new After();
		assert.deepEqual(after[method](...args), before[method](...args));
		const oldMs = medianMs(() => before[method](...args));
		const newMs = medianMs(() => after[method](...args));
		console.log(`${count * 2} nodes, ${graph.edges.length} edges | ${name}: ${oldMs.toFixed(3)} -> ${newMs.toFixed(3)} ms (${(oldMs / newMs).toFixed(1)}x, ${(100 * (1 - newMs / oldMs)).toFixed(1)}% less time)`);
	}
}

const OldProduction = baselineClass('src/app/Model/Planner/ProductionSolverService.ts', 'ProductionSolverService', ref);
const items = Array.from({length: 1000}, (_, i) => ({className: `Item${i}`}));
const itemByName = new Map(items.map(item => [item.className, item]));
const machine = {className: 'Constructor', manufacturingSpeed: 1, sloopSlots: 0};
const request = {
	optimisation: {rawResources: {Item0: 1}, inputs: false, power: 0, machines: 0}, maximise: null,
	recipes: items.slice(1).map((item, i) => ({className: `Recipe${i}`, time: 60, producedIn: [machine],
		ingredients: [{item: items[i], amount: 1}], products: [{item, amount: 1}]})),
	productions: items.map(item => ({item, amount: 1})), inputs: [], carryInputs: [], generators: [],
	maxSloops: 0, defaultClockSpeed: 100, recipeClockSpeeds: {}, machineClockSpeeds: {},
	resourceLimits: {Item0: 10000}, extraPower: ExtraPower.NONE, producePowerForFactory: false,
	powerDemand: 0, sinkPointsDemand: 0, excessPowerFraction: 0, disabledByproducts: [], sinkableItems: [],
};
const data = {resources: ['Item0'], getItemByClassName: name => itemByName.get(name)};
const oldProduction = Object.create(OldProduction.prototype), newProduction = Object.create(ProductionSolverService.prototype);
assert.equal(newProduction.buildLp(request, data), oldProduction.buildLp(request, data));
const oldLpMs = medianMs(() => oldProduction.buildLp(request, data));
const newLpMs = medianMs(() => newProduction.buildLp(request, data));
console.log(`1000 items/targets, 999 recipes | LP generation: ${oldLpMs.toFixed(3)} -> ${newLpMs.toFixed(3)} ms (${(oldLpMs / newLpMs).toFixed(1)}x, ${(100 * (1 - newLpMs / oldLpMs)).toFixed(1)}% less time)`);
