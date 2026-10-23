export const LIBRARY_API = '/server-storage.php';

export interface LibrarySession
{
	authenticated: boolean;
	csrf: string | null;
}

export async function libraryRequest(action: string, init: RequestInit = {}): Promise<Response>
{
	return fetch(`${LIBRARY_API}?action=${action}`, {credentials: 'same-origin', cache: 'no-store', signal: AbortSignal.timeout(15000), ...init});
}

export async function libraryError(response: Response): Promise<string>
{
	try {
		const body = await response.json() as {error?: unknown};
		if (typeof body.error === 'string') return body.error;
	} catch { /* A proxy may return HTML rather than JSON. */ }
	return `The server library could not be reached (HTTP ${response.status}).`;
}

/** Displayed before Angular starts, so no planner service can read an empty or unauthenticated server snapshot. */
export function showLibraryLogin(): Promise<LibrarySession>
{
	return new Promise(resolve => {
		const overlay = document.createElement('div');
		overlay.className = 'd-flex align-items-center justify-content-center p-3';
		overlay.style.cssText = 'position:fixed;inset:0;background:#2b3e50;z-index:10000;overflow:auto;';
		const form = document.createElement('form');
		form.className = 'card p-4 shadow';
		form.style.cssText = 'width:100%;max-width:420px;';
		const title = document.createElement('h1');
		title.className = 'h4';
		title.textContent = 'Your Satisfactory plans';
		const description = document.createElement('p');
		description.textContent = 'Enter your library password to access the same plans on all your devices.';
		const label = document.createElement('label');
		label.htmlFor = 'library-password';
		label.textContent = 'Library password';
		label.className = 'form-label';
		const input = document.createElement('input');
		input.id = 'library-password';
		input.type = 'password';
		input.name = 'password';
		input.autocomplete = 'current-password';
		input.className = 'form-control mb-3';
		input.required = true;
		const error = document.createElement('p');
		error.className = 'text-warning';
		error.setAttribute('role', 'alert');
		const submit = document.createElement('button');
		submit.type = 'submit';
		submit.className = 'btn btn-primary';
		submit.textContent = 'Open my library';
		form.append(title, description, label, input, error, submit);
		overlay.append(form);
		document.body.append(overlay);
		input.focus();
		form.addEventListener('submit', event => {
			event.preventDefault();
			if (submit.disabled) return;
			submit.disabled = true;
			error.textContent = '';
			void (async () => {
				try {
					const response = await libraryRequest('login', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({password: input.value})});
					input.value = '';
					if (!response.ok) throw new Error(await libraryError(response));
					const session = await response.json() as LibrarySession;
					overlay.remove();
					resolve(session);
				} catch (failure) {
					error.textContent = failure instanceof Error ? failure.message : 'Sign-in failed. Please try again.';
					submit.disabled = false;
					input.focus();
				}
			})();
		});
	});
}
