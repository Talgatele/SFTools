import {test} from 'node:test';
import assert from 'node:assert/strict';
import {graphFixture, precisionFunctions} from './performance-fixtures.mjs';
import {GraphEdgeBuilder} from '../src/app/Model/Planner/Graph/GraphEdgeBuilder.ts';
import {GraphReconciler} from '../src/app/Model/Planner/Graph/GraphReconciler.ts';
import {GraphComposer} from '../src/app/Model/Planner/Graph/GraphComposer.ts';
import {NodeIO} from '../src/app/Model/Planner/Solver/Response/NodeIO.ts';
import {ByproductNode} from '../src/app/Model/Planner/Solver/Response/ByproductNode.ts';
import {InputNode} from '../src/app/Model/Planner/Solver/Response/InputNode.ts';
import {signal} from '@angular/core';
import {CalculatorRecipesTabComponent} from '../src/app/Components/Planner/Panels/Calculator/Tabs/Recipes/CalculatorRecipesTabComponent.ts';
import {CollapsedSectionsService} from '../src/app/Components/Common/CollapsedSectionsService.ts';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import {SaveFileService} from '../src/app/Model/SaveFile/SaveFileService.ts';

test('edge rebuilding preserves prior order, duplicate IO and balances on repeated builds', () => {
	const graph = graphFixture(100, 1);
	const source = graph.nodes[0], target = graph.nodes[1];
	source.outputs = [new NodeIO(source.item, 4), new NodeIO(source.item, 6)];
	target.inputs = [new NodeIO(target.item, 7), new NodeIO(target.item, 3)];
	const prior = [...graph.edges].reverse();
	prior.unshift({sourceId: 'missing', targetId: target.id, itemClassName: source.item.className, amount: 1});
	const builder = new GraphEdgeBuilder();
	assert.deepEqual(builder.build(graph.nodes, prior), [...graph.edges].reverse());
	assert.deepEqual(builder.build(graph.nodes, prior), [...graph.edges].reverse());
	assert.ok(graph.nodes.every(node => [...node.inputs, ...node.outputs].every(io => io.remaining === 0)));
});

test('warning totals aggregate parallel edges, distinguish items and detect deficits/surpluses', () => {
	const graph = graphFixture(2, 2);
	graph.edges[0].amount = 3;
	graph.edges.push({...graph.edges[0], amount: 4}, {...graph.edges[0], itemClassName: 'OtherItem', amount: 100});
	const warnings = new GraphReconciler().computeWarnings(graph);
	assert.equal(warnings.size, 2);
	assert.deepEqual(warnings.get('source0').outputs, [{itemClassName: 'Item0', produced: 10, consumed: 7}]);
	assert.deepEqual(warnings.get('target0').inputs, [{itemClassName: 'Item0', required: 10, supplied: 7}]);
	graph.edges.push({...graph.edges[0], amount: 3});
	assert.equal(new GraphReconciler().computeWarnings(graph).size, 0);
});

test('prior routing keeps the first duplicate and distinguishes connection identities', () => {
	const edge = {sourceId: 'source', targetId: 'target', itemClassName: 'Item', amount: 10};
	const first = {...edge, vertices: [{x: 1, y: 2}], labelDistance: .3};
	const duplicate = {...edge, vertices: [{x: 8, y: 9}], labelDistance: .8};
	const other = {...edge, itemClassName: 'Other'};
	const result = new GraphComposer(new GraphEdgeBuilder()).withPriorRouting([edge, other], [first, duplicate]);
	assert.deepEqual(result[0], {...edge, vertices: first.vertices, labelDistance: .3});
	assert.equal(result[1], other);
	assert.equal(edge.vertices, undefined);
});

test('elastic inputs and byproducts resize from all connections and remove zero-flow nodes', () => {
	const graph = graphFixture(1);
	const item = graph.nodes[0].item;
	graph.nodes.push(new InputNode('input', 50, item), new ByproductNode('extra', 50, item), new ByproductNode('unused', 1, item));
	graph.edges = [
		{sourceId: 'source0', targetId: 'target0', itemClassName: item.className, amount: 6},
		{sourceId: 'source0', targetId: 'extra', itemClassName: item.className, amount: 4},
		{sourceId: 'input', targetId: 'target0', itemClassName: item.className, amount: 4},
	];
	const result = new GraphReconciler().reconcile(graph, 'source0');
	assert.equal(result.nodes.find(node => node.id === 'input').amount, 4);
	assert.equal(result.nodes.find(node => node.id === 'extra').amount, 4);
	assert.ok(!result.nodes.some(node => node.id === 'unused'));
});

test('full precision reads only primal columns, supports CRLF and a final line without newline', () => {
	const {restoreFullPrecisionPrimals} = precisionFunctions();
	for (const newline of ['\n', '\r\n']) {
		const solution = {Columns: {x: {Primal: 0}, y: {Primal: 0}}, raw: [
			'# Primal solution values', 'Feasible', '# Columns 2', 'x 1.234567890123', 'y -2.123456789',
			'# Rows 1', 'x 999', '# Dual solution values', '# Columns 1', 'x 777',
		].join(newline)};
		restoreFullPrecisionPrimals(solution);
		assert.equal(solution.Columns.x.Primal, 1.234567890123);
		assert.equal(solution.Columns.y.Primal, -2.123456789);
		assert.ok(!Object.hasOwn(solution, 'raw'));
	}
	const solution = {Columns: {x: {Primal: 0}}, raw: '# Primal solution values\n# Columns 1\nx 1.23456789'};
	restoreFullPrecisionPrimals(solution);
	assert.equal(solution.Columns.x.Primal, 1.23456789);
});

test('recipe tab caches derived state, invalidates on signals and copies selections before editing', () => {
	const recipes = [{className: 'a', name: 'Zinc', alternate: false}, {className: 'b', name: 'Alternate: Iron', alternate: true}];
	let resolutions = 0, sorts = 0;
	const settings = signal({enabledRecipes: ['a']});
	const data = signal({getRecipesForMachines: () => { sorts++; return [...recipes]; }});
	const component = new CalculatorRecipesTabComponent(
		{activeSettings: settings, updateActiveSettings: value => settings.set(value)},
		{activeVersionData: data},
		{resolve: current => { resolutions++; return new Set(current.enabledRecipes); }},
		{}, {}, new CollapsedSectionsService(),
	);
	for (let i = 0; i < 100; i++) {
		assert.equal(component.isEnabled(recipes[0]), true);
		assert.equal(component.isEnabled(recipes[1]), false);
		assert.deepEqual(component.standardRecipes, [recipes[0]]);
		assert.deepEqual(component.alternateRecipes, [recipes[1]]);
	}
	assert.equal(resolutions, 1);
	assert.equal(sorts, 1);
	const cached = component.enabledSet();
	component.toggle(recipes[1]);
	assert.equal(cached.has('b'), false);
	assert.equal(component.isEnabled(recipes[1]), true);
	assert.equal(resolutions, 2);
	component.setAll(recipes, false);
	assert.equal(component.isEnabled(recipes[0]), false);
	data.set({getRecipesForMachines: () => { sorts++; return []; }});
	assert.deepEqual(component.standardRecipes, []);
	assert.equal(sorts, 2);
});

test('overlapping worker requests share initialization and omit unused row diagnostics', async () => {
	const source = readFileSync(new URL('../src/app/Model/Planner/Solver/Worker/SolverWorker.ts', import.meta.url), 'utf8');
	const start = source.indexOf('async function loadHighs');
	const end = source.indexOf('/**', start);
	const output = ts.transpileModule(source.slice(0, start) + source.slice(end), {
		compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022},
	}).outputText;
	let loads = 0, ready, handler;
	const messages = [];
	const loading = new Promise(resolve => { ready = resolve; });
	new Function('loadHighs', 'addEventListener', 'postMessage', 'exports', output)(
		() => { loads++; return loading; }, (_, callback) => { handler = callback; }, message => messages.push(message), {},
	);
	const first = handler({data: {id: 'first', problem: 'LP'}});
	const second = handler({data: {id: 'second', problem: 'LP'}});
	assert.equal(loads, 1);
	ready({solve: () => ({Status: 'Optimal', Columns: {}, Rows: [{Name: 'unused'}]})});
	await Promise.all([first, second]);
	assert.deepEqual(messages.map(message => message.id), ['first', 'second']);
	assert.ok(messages.every(message => message.error === null && message.solution.Rows.length === 0));
});

test('cancelling save parsing does not post a subsequently resolved file buffer', async () => {
	const previous = globalThis.Worker;
	let resolveBuffer, posts = 0, terminations = 0;
	globalThis.Worker = class {
		addEventListener() {}
		postMessage() { posts++; }
		terminate() { terminations++; }
	};
	try {
		const file = {name: 'large.sav', arrayBuffer: () => new Promise(resolve => { resolveBuffer = resolve; })};
		const subscription = new SaveFileService().parse(file).subscribe();
		subscription.unsubscribe();
		resolveBuffer(new ArrayBuffer(8));
		await Promise.resolve();
		assert.equal(posts, 0);
		assert.equal(terminations, 1);
	} finally {
		if (previous === undefined) delete globalThis.Worker;
		else globalThis.Worker = previous;
	}
});
