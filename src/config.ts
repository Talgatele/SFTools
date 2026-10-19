import {ApplicationConfig, ErrorHandler, isDevMode, importProvidersFrom, provideBrowserGlobalErrorListeners} from '@angular/core';
import {HTTP_INTERCEPTORS, provideHttpClient, withFetch, withInterceptorsFromDi} from '@angular/common/http';
import {TitleStrategy, provideRouter, withComponentInputBinding, withInMemoryScrolling} from '@angular/router';
import {AppPositioningService} from '@src/AppPositioningService';
import {AppTooltipConfig} from '@src/AppTooltipConfig';
import {ApiCallLogInterceptor} from '@src/Model/Errors/ApiCallLogInterceptor';
import {AppErrorHandler} from '@src/Model/Errors/AppErrorHandler';
import {RetryInterceptor} from '@src/Model/API/RetryInterceptor';
import {ConnectivityInterceptor} from '@src/Model/Network/ConnectivityInterceptor';
import {AppTitleStrategy} from '@src/Model/Meta/AppTitleStrategy';
import {RouteList} from '@src/RouteList';
import {BrowserAnimationsModule} from '@angular/platform-browser/animations';
import {CollapseModule} from 'ngx-bootstrap/collapse';
import {BsDropdownModule} from 'ngx-bootstrap/dropdown';
import {PositioningService} from 'ngx-bootstrap/positioning';
import {TooltipConfig} from 'ngx-bootstrap/tooltip';

export const config: ApplicationConfig = {
	providers: [
		// Otherwise a long codex page opened from far down another one starts scrolled to its end.
		provideRouter(
			RouteList.routes,
			withComponentInputBinding(),
			withInMemoryScrolling({scrollPositionRestoration: 'enabled'}),
		),
		provideHttpClient(withFetch(), withInterceptorsFromDi()),
		{provide: HTTP_INTERCEPTORS, useClass: RetryInterceptor, multi: true},
		{provide: HTTP_INTERCEPTORS, useClass: ConnectivityInterceptor, multi: true},
		{provide: HTTP_INTERCEPTORS, useClass: ApiCallLogInterceptor, multi: true},
		{provide: TooltipConfig, useClass: AppTooltipConfig},
		{provide: PositioningService, useClass: AppPositioningService},
		{provide: TitleStrategy, useClass: AppTitleStrategy},
		importProvidersFrom([
			BrowserAnimationsModule,
			CollapseModule,
			BsDropdownModule,
		]),
		// After importProvidersFrom: BrowserModule (pulled in by BrowserAnimationsModule) provides the default handler.
		{provide: ErrorHandler, useClass: AppErrorHandler},
		// Also creates the handler at startup, so the first error that reaches it is not the one that broke rendering.
		provideBrowserGlobalErrorListeners(),
	],
};
