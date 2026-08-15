import path from 'node:path';
import process from 'node:process';
import fs from 'fs-extra';
import ignore from 'ignore';
import JSZip from 'jszip';

import * as extensionConfig from '../extension.json';

function multiLineStrToArray(value: string): string[] {
	return value.split(/[\r\n]+/).filter(Boolean);
}

function isValidUuid(uuid?: string): uuid is string {
	return Boolean(uuid && /^[a-z0-9]{32}$/.test(uuid.trim()) && uuid !== '00000000000000000000000000000000');
}

async function main(): Promise<void> {
	if (!isValidUuid(extensionConfig.uuid)) {
		throw new Error(`Invalid extension UUID: ${extensionConfig.uuid}`);
	}

	const root = path.join(__dirname, '..');
	const ignoreFile = path.join(root, '.edaignore');
	const ignoreRules = multiLineStrToArray(fs.readFileSync(ignoreFile, 'utf-8'))
		.map(line => (line.endsWith('/') || line.endsWith('\\')) ? line.slice(0, -1) : line);
	const matcher = ignore().add(ignoreRules);
	const allEntries = fs.readdirSync(root, { encoding: 'utf-8', recursive: true });
	const includedEntries = matcher.filter(allEntries);
	const files = includedEntries
		.filter(entry => fs.lstatSync(path.join(root, entry)).isFile())
		.map(entry => entry.replace(/\\/g, '/'));

	const zip = new JSZip();
	for (const file of files) {
		zip.file(file, fs.createReadStream(path.join(root, file)));
	}

	const outputDirectory = path.join(__dirname, 'dist');
	fs.ensureDirSync(outputDirectory);
	const outputPath = path.join(outputDirectory, `${extensionConfig.name}_v${extensionConfig.version}.eext`);
	const output = fs.createWriteStream(outputPath);

	await new Promise<void>((resolve, reject) => {
		output.once('finish', resolve);
		output.once('error', reject);
		const archive = zip.generateNodeStream({
			type: 'nodebuffer',
			streamFiles: true,
			compression: 'DEFLATE',
			compressionOptions: { level: 9 },
		});
		archive.once('error', reject);
		archive.pipe(output);
	});

	console.log(`EEXT package: ${outputPath}`);
	console.log(`Packaged files (${files.length}):`);
	for (const file of files) console.log(`- ${file}`);
}

void main().catch((error: unknown) => {
	console.error(error);
	process.exitCode = 1;
});
