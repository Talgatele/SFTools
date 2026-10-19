import '@angular/compiler';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createRequire} from 'node:module';
import ts from 'typescript';
import {MineNode} from '../src/app/Model/Planner/Solver/Response/MineNode.ts';
import {ProductNode} from '../src/app/Model/Planner/Solver/Response/ProductNode.ts';

export function graphFixture(count, itemCount = 16) {
	const items = Array.from({length: itemCount}, (_, i) => ({className: `Item${i}`, name: `Item ${i}`}));
	const nodes = [], edges = [];
	for (let i = 0; i < count; i++) {
		const item = items[i % items.length];
		nodes.push(new MineNode(`source${i}`, 10, item), new ProductNode(`target${i}`, 10, item));
		edges.push({sourceId: `source${i}`, targetId: `target${i}`, itemClassName: item.className, amount: 10});
	}
	return {nodes, edges};
}

// Load the original method implementations against the same domain classes as the working tree.
export function baselineClass(path, name, ref) {
	const source = execFileSync('git', ['show', `${ref}:${path}`], {encoding: 'utf8'});
	const output = ts.transpileModule(source, {compilerOptions: {
		module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, experimentalDecorators: true,
	}}).outputText;
	const exports = {};
	new Function('require', 'exports', output)(createRequire(import.meta.url), exports);
	return exports[name];
}

export function precisionFunctions() {
	const source = readFileSync(new URL('../src/app/Model/Planner/Solver/Worker/SolverWorker.ts', import.meta.url), 'utf8');
	const output = ts.transpileModule(source.slice(0, source.indexOf("addEventListener('message'")), {
		compilerOptions: {module: ts.ModuleKind.CommonJS},
	}).outputText;
	return new Function('exports', output + '; return {restoreFullPrecisionPrimals};')({});
}
