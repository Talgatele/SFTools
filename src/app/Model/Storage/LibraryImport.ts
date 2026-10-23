import {PlanStore} from '@src/Model/Planner/PlanStore';

/** Import browser data without overwriting a server plan. Differing IDs are preserved as a separate tree. */
export function mergeLibraryImport(key: string, local: string, remote: string | null): string
{
	if (key === 'sftools.customVersions') {
		const source: unknown = JSON.parse(local);
		const target: unknown = remote === null ? [] : JSON.parse(remote);
		if (!Array.isArray(source) || !Array.isArray(target) || [...source, ...target].some(id => typeof id !== 'string')) throw new Error('The custom-version list is invalid. Your browser copy has been retained.');
		return JSON.stringify([...new Set([...target, ...source])]);
	}
	const source = JSON.parse(local) as PlanStore;
	if (source === null || typeof source !== 'object' || !Array.isArray(source.plans)
		|| (source.folders !== undefined && !Array.isArray(source.folders))) throw new Error('The browser plan library is invalid. Its original copy has been retained.');
	const folders = source.folders ?? [];
	const plans = source.plans ?? [];
	if ([...folders, ...plans].some(entry => entry === null || typeof entry.id !== 'string')) throw new Error('A browser plan has an invalid ID. Its original copy has been retained.');
	if (remote === null) return JSON.stringify({folders, plans});
	const target = JSON.parse(remote) as PlanStore;
	const existing = new Map([...target.folders, ...target.plans].map(entry => [entry.id, JSON.stringify(entry)]));
	const conflict = [...folders, ...plans].some(entry => existing.has(entry.id) && existing.get(entry.id) !== JSON.stringify(entry));
	if (!conflict) {
		return JSON.stringify({
			folders: [...target.folders, ...folders.filter(entry => !existing.has(entry.id))],
			plans: [...target.plans, ...plans.filter(entry => !existing.has(entry.id))],
		});
	}
	const ids = new Map([...folders, ...plans].map(entry => [entry.id, crypto.randomUUID()]));
	const groupId = crypto.randomUUID();
	const group = {id: groupId, name: 'Imported browser plans', parentId: null, settings: null, fixedGroups: [], resourcePool: false, revision: null};
	const importedFolders = folders.map(folder => ({...folder, id: ids.get(folder.id)!, parentId: folder.parentId === null ? groupId : ids.get(folder.parentId) ?? groupId}));
	const importedPlans = plans.map(plan => ({
		...plan,
		id: ids.get(plan.id)!,
		parentPlanId: plan.parentPlanId === null ? null : ids.get(plan.parentPlanId) ?? null,
		folderId: plan.folderId === null ? (plan.parentPlanId === null ? groupId : null) : ids.get(plan.folderId) ?? groupId,
		graph: plan.graph === null || plan.graph === undefined ? null : {
			...plan.graph,
			nodes: plan.graph.nodes.map(node => {
				const subplanId = (node as unknown as {subplanId?: string}).subplanId;
				return subplanId !== undefined && ids.has(subplanId) ? {...node, subplanId: ids.get(subplanId)} : node;
			}),
		},
	}));
	return JSON.stringify({folders: [...target.folders, group, ...importedFolders], plans: [...target.plans, ...importedPlans]});
}
