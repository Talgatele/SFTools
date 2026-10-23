import {Injectable} from '@angular/core';
import {HttpErrorResponse, HttpEvent, HttpHandler, HttpInterceptor, HttpRequest} from '@angular/common/http';
import {Observable, throwError, timer} from 'rxjs';
import {catchError, finalize, switchMap} from 'rxjs/operators';
import {env} from '@env/env';
import {ServerStatusService} from '@src/Model/API/ServerStatusService';
import {ConnectivityService} from '@src/Model/Network/ConnectivityService';

/** Totals just over half a minute - how long a deployment takes to swap the API over. */
const RETRY_DELAYS = [2000, 5000, 10000, 15000];

/** A gateway error can arrive after an upstream write committed. Only safe methods may be replayed. */
const GATEWAY_STATUSES = [502, 503, 504];

const SAFE_METHODS = ['GET', 'HEAD', 'OPTIONS'];

/** Retry transient failures of reads without replaying writes. */
@Injectable()
export class RetryInterceptor implements HttpInterceptor
{

	public constructor(
		private readonly serverStatus: ServerStatusService,
		private readonly connectivity: ConnectivityService,
	)
	{
	}

	public intercept(req: HttpRequest<unknown>, next: HttpHandler): Observable<HttpEvent<unknown>>
	{
		if (!req.url.startsWith(env.apiUrl)) {
			return next.handle(req);
		}
		return this.attempt(req, next, 0);
	}

	private attempt(req: HttpRequest<unknown>, next: HttpHandler, attempt: number): Observable<HttpEvent<unknown>>
	{
		return next.handle(req).pipe(
			catchError((err: unknown) => {
				if (attempt >= RETRY_DELAYS.length || !this.isRetryable(req, err)) {
					return throwError(() => err);
				}
				this.serverStatus.retryStarted();
				return timer(RETRY_DELAYS[attempt]).pipe(
					switchMap(() => this.attempt(req, next, attempt + 1)),
					finalize(() => this.serverStatus.retryFinished()),
				);
			}),
		);
	}

	private isRetryable(req: HttpRequest<unknown>, err: unknown): boolean
	{
		if (!(err instanceof HttpErrorResponse)) {
			return false;
		}
		if (!SAFE_METHODS.includes(req.method.toUpperCase())) {
			return false;
		}
		if (GATEWAY_STATUSES.includes(err.status)) {
			return true;
		}
		// Status 0 never completed, so only replay safe methods while the browser reports a connection.
		return err.status === 0 && this.connectivity.online();
	}

}
