import {Injectable} from '@angular/core';

@Injectable({providedIn: 'root'})
export class FileDownloader
{

	public async download(blob: Blob, fileName: string): Promise<void>
	{
		const url = URL.createObjectURL(blob);
		const anchor = document.createElement('a');
		anchor.href = url;
		anchor.download = fileName;
		anchor.click();
		// The click starts the download asynchronously; revoking at once can cancel it.
		setTimeout(() => URL.revokeObjectURL(url), 10_000);
	}

	public safeName(name: string, extension: string, fallback: string): string
	{
		const cleaned = name.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim();
		return `${cleaned === '' ? fallback : cleaned}.${extension}`;
	}

}
