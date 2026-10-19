import {Injectable} from '@angular/core';

@Injectable({providedIn: 'root'})
export class PublicUrlService
{
	public url(path: string): string
	{
		return window.location.origin + path;
	}
}
