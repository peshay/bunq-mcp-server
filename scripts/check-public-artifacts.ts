import { readFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import {
  findPublicArtifactFindings,
  isPublicArtifactFile,
} from '../src/utils/public-artifact-guard.js';

const execFileAsync = promisify(execFile);

async function listTrackedFiles(): Promise<string[]> {
  const { stdout } = await execFileAsync('git', ['ls-files']);
  return stdout
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .filter(isPublicArtifactFile);
}

async function main() {
  const inputFiles = process.argv.slice(2).filter(Boolean);
  const files = inputFiles.length > 0 ? inputFiles : await listTrackedFiles();
  const findings = [] as ReturnType<typeof findPublicArtifactFindings>;

  for (const filePath of files) {
    try {
      const content = await readFile(filePath, 'utf8');
      findings.push(...findPublicArtifactFindings(filePath, content));
    } catch {
      // Ignore unreadable files so deleted files or non-text blobs do not fail the hook.
    }
  }

  if (findings.length === 0) {
    return;
  }

  console.error('Public artifact guard found private path leaks:');
  for (const finding of findings) {
    console.error(`- ${finding.filePath}: ${finding.match}`);
  }
  process.exitCode = 1;
}

await main();
