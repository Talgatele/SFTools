import {Injectable} from '@angular/core';
import {env} from '@env/env';

@Injectable({providedIn: 'root'})
export class PublicUrlService
{
	public url(path: string): string
	{
		return env.webUrl + path;
	}
}
