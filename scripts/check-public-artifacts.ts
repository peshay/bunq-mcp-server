import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

import {
  findPublicArtifactFindings,
  isPublicArtifactFile,
  type PublicArtifactFinding,
} from '../src/utils/public-artifact-guard.js';

const execFileAsync = promisify(execFile);

type ExecFile = (file: string, args: string[]) => Promise<{ stdout: string }>;
type ReadTextFile = (filePath: string, encoding: BufferEncoding) => Promise<string>;
type WriteError = (message: string) => void;

export async function listTrackedPublicArtifactFiles(exec: ExecFile = execFileAsync): Promise<string[]> {
  const { stdout } = await exec('git', ['ls-files']);
  return stdout
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .filter(isPublicArtifactFile);
}

export interface PublicArtifactCheckOptions {
  args?: string[];
  listFiles?: () => Promise<string[]>;
  readTextFile?: ReadTextFile;
  writeError?: WriteError;
}

export async function runPublicArtifactCheck({
  args = process.argv.slice(2),
  listFiles = listTrackedPublicArtifactFiles,
  readTextFile = readFile,
  writeError = (message: string) => console.error(message),
}: PublicArtifactCheckOptions = {}): Promise<number> {
  const inputFiles = args.filter(Boolean);
  const files = inputFiles.length > 0 ? inputFiles : await listFiles();
  const findings: PublicArtifactFinding[] = [];

  for (const filePath of files) {
    try {
      const content = await readTextFile(filePath, 'utf8');
      findings.push(...findPublicArtifactFindings(filePath, content));
    } catch {
      // Ignore unreadable files so deleted files or non-text blobs do not fail the hook.
    }
  }

  if (findings.length === 0) {
    return 0;
  }

  writeError('Public artifact guard found private path leaks:');
  for (const finding of findings) {
    writeError(`- ${finding.filePath}: ${finding.match}`);
  }
  return 1;
}

function isMainModule(): boolean {
  const invokedScript = process.argv[1];
  return invokedScript !== undefined && import.meta.url === pathToFileURL(invokedScript).href;
}

if (isMainModule()) {
  process.exitCode = await runPublicArtifactCheck();
}
