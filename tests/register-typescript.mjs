import {registerHooks} from 'node:module';
import {readFileSync, existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import ts from 'typescript';

// Run domain regressions with Node's test runner, without an Angular browser target.
registerHooks({
	resolve(specifier, context, nextResolve) {
		let url;
		if (specifier.startsWith('@src/')) {
			url = new URL('../src/app/' + specifier.slice(5) + '.ts', import.meta.url);
		} else if (specifier.startsWith('.') && context.parentURL?.endsWith('.ts')) {
			url = new URL(specifier + '.ts', context.parentURL);
		}
		if (url && existsSync(url)) return {url: url.href, shortCircuit: true};
		return nextResolve(specifier, context);
	},
	load(url, context, nextLoad) {
		if (!url.endsWith('.ts') || url.includes('/node_modules/')) return nextLoad(url, context);
		return {format: 'module', shortCircuit: true, source: ts.transpileModule(readFileSync(fileURLToPath(url), 'utf8'), {
			compilerOptions: {target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, experimentalDecorators: true},
		}).outputText};
	},
});
