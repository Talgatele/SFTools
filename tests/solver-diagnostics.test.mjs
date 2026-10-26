import '@angular/compiler';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {firstValueFrom} from 'rxjs';
import {ProductionSolverService} from '../src/app/Model/Planner/ProductionSolverService.ts';

function fixture() {
 const items = ['Heavy Modular Frame', 'Fused Modular Frame', 'Aluminium Casing', 'Bauxite', 'Nitrogen Gas', 'Iron Ore'].map(name => ({name, className: name}));
 const item = name => items.find(item => item.name === name);
 const recipe = (name, ingredients, product) => ({name, className: name, ingredients: ingredients.map(name => ({item: item(name), amount: 1})), products: [{item: item(product), amount: 1}]});
 const recipes = [recipe('Fuse', ['Heavy Modular Frame', 'Aluminium Casing', 'Nitrogen Gas'], 'Fused Modular Frame'), recipe('Casing', ['Bauxite'], 'Aluminium Casing'), recipe('Heavy', ['Iron Ore'], 'Heavy Modular Frame')];
 const data = {items, resources: ['Bauxite', 'Nitrogen Gas', 'Iron Ore'], getRecipesForMachines: () => recipes, searchItemByClassName: item};
 const service = Object.create(ProductionSolverService.prototype);
 service.versionManager = {activeVersionData: () => data};
 service.enabledRecipes = {resolve: settings => new Set(settings.enabledRecipes ?? recipes.map(r => r.className)), isDisabledByMachine: (r, settings) => settings.disabledMachines?.includes(r.className) ?? false};
 service.pool = {effectiveLimits: plan => plan.settings.resourceLimits};
 service.enabledGenerators = () => [];
 const plan = {requests: [{itemClassName: 'Fused Modular Frame', ratePerMinute: 1}], inputs: [{itemClassName: 'Heavy Modular Frame', amount: 2}], settings: {resourceLimits: {'Bauxite': 0, 'Nitrogen Gas': 0, 'Iron Ore': 0}}};
 return {service, plan, recipes, recipe};
}

test('diagnostic traces missing raw resources and stops at supplied intermediates', async () => {
 const {service, plan} = fixture();
 const message = await firstValueFrom(service.diagnoseFailure(plan));
 assert.match(message, /missing: Bauxite .*Nitrogen Gas /);
 assert.doesNotMatch(message, /Iron Ore/);
 assert.match(message, /Inputs, Recipes, Machines and Resources/);
});

test('disabled recipes and machines are named with actionable fixes', async () => {
 const {service, plan} = fixture();
 plan.settings.enabledRecipes = ['Fuse', 'Heavy'];
 assert.match(await firstValueFrom(service.diagnoseFailure(plan)), /Aluminium Casing \(enable a producing recipe in Recipes/);
 plan.settings.enabledRecipes.push('Casing');
 plan.settings.disabledMachines = ['Casing'];
 assert.match(await firstValueFrom(service.diagnoseFailure(plan)), /Aluminium Casing \(enable a producing machine in Machines/);
});

test('alternative routes do not list all alternatives as required resources', async () => {
 const {service, plan, recipes, recipe} = fixture();
 recipes.push(recipe('Alternate casing', ['Iron Ore'], 'Aluminium Casing'));
 const message = await firstValueFrom(service.diagnoseFailure(plan));
 assert.match(message, /One recipe route/);
 assert.doesNotMatch(message, /Iron Ore/);
});

test('cycles terminate and request an external ingredient source', async () => {
 const {service, plan, recipes, recipe} = fixture();
 recipes.splice(1, 1, recipe('Cyclic casing', ['Fused Modular Frame'], 'Aluminium Casing'));
 assert.match(await firstValueFrom(service.diagnoseFailure(plan)), /no reachable ingredient source/);
});

test('locked outputs and positive supplied inputs are not reported missing', async () => {
 const {service, plan} = fixture();
 plan.inputs.push({itemClassName: 'Bauxite', amount: 0});
 const message = await firstValueFrom(service.diagnoseFailure(plan, [{outputs: [{item: {className: 'Aluminium Casing'}}]}]));
 assert.match(message, /missing: Nitrogen Gas/);
 assert.doesNotMatch(message, /Bauxite/);
});

test('resource limit failures list required and available rates', async () => {
 const {MineNode} = await import('../src/app/Model/Planner/Solver/Response/MineNode.ts');
 const {of} = await import('rxjs');
 const {service, plan} = fixture();
 plan.settings.resourceLimits = {'Bauxite': 10, 'Nitrogen Gas': 10, 'Iron Ore': 0};
 service.extraPower = {resolve: () => ({matrixDemand: 0})};
 service.pool.status = () => null;
 service.solve = () => of({status: 'Optimal', nodes: [Object.assign(Object.create(MineNode.prototype), {item: {className: 'Bauxite', name: 'Bauxite'}, amount: 25})]});
 const message = await firstValueFrom(service.diagnoseFailure(plan));
 assert.match(message, /Bauxite: 25\/min needed, 10\/min available/);
});
