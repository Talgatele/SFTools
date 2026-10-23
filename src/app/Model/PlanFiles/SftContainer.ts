/**
 * The .sft layout shared by the old tools (format "0") and this app (format "1"):
 * `#` comment lines, then the format character followed by base64 of zlib-deflated JSON.
 * The old tools reject any other format character, so a new format fails cleanly there.
 */
export class SftContainer
{

	public static readonly oldToolsFormat = '0';
	public static readonly planFormat = '1';
	public static readonly maxFileCharacters = 32 * 1024 * 1024;
	public static readonly maxDecodedBytes = 64 * 1024 * 1024;

	public static payload(content: string): string
	{
		if (content.length > this.maxFileCharacters) {
			throw new Error('The export exceeds the 32 MiB file limit.');
		}
		return content
			.split('\n')
			.map(line => line.trim())
			.filter(line => line !== '' && !line.startsWith('#'))
			.join('');
	}

	public static format(content: string): string | null
	{
		const payload = SftContainer.payload(content);
		return payload === '' ? null : payload.charAt(0);
	}

	public static async decode(payload: string): Promise<string>
	{
		if (payload.length > this.maxFileCharacters) {
			throw new Error('The export exceeds the 32 MiB file limit.');
		}
		const bytes = Uint8Array.from(atob(payload.substring(1)), char => char.charCodeAt(0));
		const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate'));
		const reader = stream.getReader();
		const decoder = new TextDecoder();
		const parts: string[] = [];
		let size = 0;
		try {
			while (true) {
				const {done, value} = await reader.read();
				if (done) break;
				size += value.byteLength;
				if (size > this.maxDecodedBytes) {
					await reader.cancel();
					throw new Error('The export expands beyond the 64 MiB data limit.');
				}
				parts.push(decoder.decode(value, {stream: true}));
			}
			parts.push(decoder.decode());
			return parts.join('');
		} finally {
			reader.releaseLock();
		}
	}

	public static async encode(format: string, json: string, header: string[]): Promise<string>
	{
		if (new Blob([json]).size > this.maxDecodedBytes) {
			throw new Error('The export exceeds the 64 MiB data limit. Export fewer plans at a time.');
		}
		const stream = new Blob([json]).stream().pipeThrough(new CompressionStream('deflate'));
		const bytes = new Uint8Array(await new Response(stream).arrayBuffer());
		let binary = '';
		// Chunked: spreading a large array into fromCharCode overflows the call stack.
		for (let offset = 0; offset < bytes.length; offset += 0x8000) {
			binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
		}
		const content = header.map(line => `# ${line}`).join('\n') + '\n\n' + format + btoa(binary) + '\n';
		if (content.length > this.maxFileCharacters) {
			throw new Error('The export exceeds the 32 MiB file limit. Export fewer plans at a time.');
		}
		return content;
	}

}
