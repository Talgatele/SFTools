import {Injectable, Signal, WritableSignal, computed, signal} from '@angular/core';
import {TokenResponse} from '@src/Model/API/Schema/Auth/TokenResponse';

@Injectable({providedIn: 'root'})
export class AuthService
{

	private readonly accessTokenSignal: WritableSignal<string | null>;
	private readonly loginSignal: WritableSignal<string | null>;

	public readonly accessToken: Signal<string | null>;
	public readonly currentLogin: Signal<string | null>;
	public readonly isAuthenticated: Signal<boolean>;
	/** Third-party sign-ins have no username: their stored login is a "via Discord" placeholder, so this is null for them. */
	public readonly displayName: Signal<string | null>;

	public constructor()
	{
		this.accessTokenSignal = signal(null);
		this.loginSignal = signal(null);
		this.accessToken = this.accessTokenSignal.asReadonly();
		this.currentLogin = this.loginSignal.asReadonly();
		this.isAuthenticated = computed(() => false);
		this.displayName = computed(() => {
			const login = this.currentLogin();
			return login === null || login.startsWith('via ') ? null : login;
		});
	}

	public storeSession(login: string, response: TokenResponse): void
	{
		void login;
		void response;
		throw new Error('Sign-in is disabled in this local-only build.');
	}

	public clearSession(): number
	{
		throw new Error('Sign-out is unavailable because accounts are disabled in this local-only build.');
	}

	public getRefreshToken(): string | null
	{
		return null;
	}

	public isExpired(): boolean
	{
		return true;
	}

}
