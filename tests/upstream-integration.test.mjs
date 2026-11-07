import '@angular/compiler';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {ResourcePoolService} from '../src/app/Model/Planner/Pool/ResourcePoolService.ts';
import {SubplanBuildCounter} from '../src/app/Model/Planner/SubplanBuildCounter.ts';
import {SettingsDefaults} from '../src/app/Model/Settings/SettingsDefaults.ts';
import {VersionFileCaching} from '../src/app/Model/API/VersionFileCaching.ts';

test('map resource summaries include subplans while shared pools count each graph once', () => {
	const mine = amount => ({type: 'mine', itemClassName: 'Ore', amount});
	const parent = {id: 'parent', parentPlanId: null, settings: {resourceLimits: {Ore: 100}},
		graph: {nodes: [mine(10), {type: 'subplan', subplanId: 'child', buildCount: 2}]}};
	const child = {id: 'child', parentPlanId: 'parent', graph: {nodes: [mine(20)]}};
	const other = {id: 'other', parentPlanId: null, graph: {nodes: [mine(5)]}};
	const plans = [parent, child, other];
	const manager = {
		findPlan: id => plans.find(plan => plan.id === id) ?? null,
		subplansOf: id => id === 'parent' ? [child] : [],
		innerPlans: () => plans,
		poolFolderOf: () => ({id: 'folder'}),
	};
	const pool = new ResourcePoolService(manager, {}, new SubplanBuildCounter(manager));
	assert.equal(pool.usageOfPlan(parent).get('Ore'), 50);
	assert.equal(pool.usageInFolder('folder').get('Ore'), 55);
	assert.equal(pool.effectiveLimits(parent).Ore, 55);
});

test('older display settings gain map defaults and preserve this fork\'s planner defaults', () => {
	const defaults = SettingsDefaults.normalize(null);
	const settings = SettingsDefaults.normalize({planner: {...defaults.planner, helpButtons: false}});
	assert.deepEqual(settings.map, {coordinates: 'game', arachnophobia: true});
	assert.equal(settings.planner.helpButtons, false);
	assert.deepEqual(settings.planDefaults, defaults.planDefaults);
});

test('official version files revalidate and content-addressed custom versions remain cacheable', () => {
	assert.equal(VersionFileCaching.mode('data/versions/stable.json'), 'no-cache');
	assert.equal(VersionFileCaching.mode('data/versions/custom/hash.json'), 'default');
});
