import {Injectable} from '@angular/core';
import {GraphEdge} from '@src/Model/Planner/Graph/GraphEdge';
import {Node} from '@src/Model/Planner/Solver/Response/Node';
import {NodeIO} from '@src/Model/Planner/Solver/Response/NodeIO';

@Injectable({providedIn: 'root'})
export class GraphEdgeBuilder
{

	/** Resets the IO bookkeeping first: the nodes may already have had their edges built once. */
	public build(nodes: Node[], priorEdges: GraphEdge[] = []): GraphEdge[]
	{
		nodes.forEach(node => {
			node.inputs.forEach(io => io.reset());
			node.outputs.forEach(io => io.reset());
		});

		interface IndexedIO {
			nodeId: string;
			io: NodeIO;
		}

		const outputsByItem = new Map<string, IndexedIO[]>();
		const inputsByItem = new Map<string, IndexedIO[]>();
		// Only needed when preserving connections. Key by node, then item, to avoid scanning
		// every producer/consumer of an item for every prior edge (and allocating filtered arrays).
		const outputsByNode = new Map<string, Map<string, NodeIO[]>>();
		const inputsByNode = new Map<string, Map<string, NodeIO[]>>();
		const indexNodeIO = (index: Map<string, Map<string, NodeIO[]>>, nodeId: string, io: NodeIO) => {
			let items = index.get(nodeId);
			if (!items) index.set(nodeId, items = new Map());
			const ios = items.get(io.item.className);
			if (ios) ios.push(io);
			else items.set(io.item.className, [io]);
		};

		nodes.forEach(node => {
			node.outputs.forEach(io => {
				const key = io.item.className;
				if (!outputsByItem.has(key)) outputsByItem.set(key, []);
				outputsByItem.get(key)!.push({nodeId: node.id, io});
				if (priorEdges.length > 0) indexNodeIO(outputsByNode, node.id, io);
			});
			node.inputs.forEach(io => {
				const key = io.item.className;
				if (!inputsByItem.has(key)) inputsByItem.set(key, []);
				inputsByItem.get(key)!.push({nodeId: node.id, io});
				if (priorEdges.length > 0) indexNodeIO(inputsByNode, node.id, io);
			});
		});

		const edges: GraphEdge[] = [];

		priorEdges.forEach(prior => {
			const outputs = outputsByNode.get(prior.sourceId)?.get(prior.itemClassName) ?? [];
			const inputs = inputsByNode.get(prior.targetId)?.get(prior.itemClassName) ?? [];
			let amount = 0;
			outputs.forEach(out => {
				inputs.forEach(inp => {
					const take = Math.min(out.remaining, inp.remaining);
					out.remaining -= take;
					inp.remaining -= take;
					amount += take;
				});
			});
			if (amount > 1e-6) {
				edges.push({sourceId: prior.sourceId, targetId: prior.targetId, itemClassName: prior.itemClassName, amount});
			}
		});

		for (const [itemClassName, outputs] of outputsByItem) {
			const inputs = inputsByItem.get(itemClassName);
			if (!inputs) continue;

			outputs.sort((a, b) => b.io.remaining - a.io.remaining);
			inputs.sort((a, b) => b.io.remaining - a.io.remaining);

			let i = 0;
			let j = 0;
			while (i < outputs.length && j < inputs.length) {
				const out = outputs[i];
				const inp = inputs[j];
				if (out.io.isDepleted()) {
					i++;
					continue;
				}
				if (inp.io.isDepleted()) {
					j++;
					continue;
				}
				const amount = Math.min(out.io.remaining, inp.io.remaining);

				edges.push({
					sourceId: out.nodeId,
					targetId: inp.nodeId,
					itemClassName,
					amount,
				});

				out.io.remaining -= amount;
				inp.io.remaining -= amount;

				if (out.io.isDepleted()) i++;
				if (inp.io.isDepleted()) j++;
			}
		}

		return edges;
	}

}
