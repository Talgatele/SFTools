import {Item} from '@src/Model/Data/Entities/Item';
import {MaximiseCategory} from '@src/Model/Planner/Solver/Request/MaximiseCategory';

export interface MaximiseTarget
{

	category: MaximiseCategory;
	items: Item[];
	satisfactory: boolean;
	/** Reserve useful material output, then give power precedence over further item growth. */
	alsoPower?: boolean;
	/** Bound basic material targets to two full production machines for a combined power plan. */
	reserveForPower?: boolean;
	/** Optional ceiling for a recipe-based Satisfactory target. */
	maximumRate?: number;

}
