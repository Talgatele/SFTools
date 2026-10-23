import {Injectable, computed} from '@angular/core';

@Injectable({providedIn: 'root'})
export class AuthService
{

	/** Account-backed branches in shared planner services stay disabled in this build. */
	public readonly isAuthenticated = computed(() => false);

}
