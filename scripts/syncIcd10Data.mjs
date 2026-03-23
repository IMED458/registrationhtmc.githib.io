import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');
const sourcePath = path.resolve(repoRoot, '..', 'inpatienter.github.io', 'icd10.js');
const targetDir = path.resolve(repoRoot, 'src', 'data');
const targetPath = path.join(targetDir, 'icd10Data.js');
const prefix = 'const ICD10_KA=';

const source = await readFile(sourcePath, 'utf8');

if (!source.startsWith(prefix)) {
  throw new Error(`Unexpected ICD-10 source format: ${sourcePath}`);
}

const transformed = `export const ICD10_KA = ${source.slice(prefix.length).trim()}\n`;

await mkdir(targetDir, { recursive: true });
await writeFile(targetPath, transformed, 'utf8');
