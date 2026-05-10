import { describe, expect, it } from 'vitest';

import {
  listTrackedPublicArtifactFiles,
  runPublicArtifactCheck,
} from '../../scripts/check-public-artifacts.js';

describe('check-public-artifacts script', () => {
  it('filters tracked files to public artifacts', async () => {
    const files = await listTrackedPublicArtifactFiles(async (file, args) => {
      expect(file).toBe('git');
      expect(args).toEqual(['ls-files']);
      return {
        stdout: [
          'README.md',
          'src/index.ts',
          '.github/workflows/ci.yml',
          'examples/openclaw.mcp.json',
          '',
        ].join('\n'),
      };
    });

    expect(files).toEqual([
      'README.md',
      '.github/workflows/ci.yml',
      'examples/openclaw.mcp.json',
    ]);
  });

  it('uses explicit file args instead of listing tracked files', async () => {
    const readFiles: string[] = [];

    const exitCode = await runPublicArtifactCheck({
      args: ['README.md'],
      listFiles: async () => {
        throw new Error('should not list tracked files when args are provided');
      },
      readTextFile: async (filePath) => {
        readFiles.push(filePath);
        return '# clean public docs\n';
      },
      writeError: () => {
        throw new Error('should not write errors for clean artifacts');
      },
    });

    expect(exitCode).toBe(0);
    expect(readFiles).toEqual(['README.md']);
  });

  it('passes clean tracked public artifacts', async () => {
    const exitCode = await runPublicArtifactCheck({
      args: [],
      listFiles: async () => ['README.md', 'SECURITY.md'],
      readTextFile: async () => '# clean public docs\n',
      writeError: () => {
        throw new Error('should not write errors for clean artifacts');
      },
    });

    expect(exitCode).toBe(0);
  });

  it('prints findings and returns a non-zero exit code', async () => {
    const errors: string[] = [];

    const exitCode = await runPublicArtifactCheck({
      args: ['README.md'],
      readTextFile: async () => 'Do not publish /home/openclaw/project paths.\n',
      writeError: (message) => errors.push(message),
    });

    expect(exitCode).toBe(1);
    expect(errors).toEqual([
      'Public artifact guard found private path leaks:',
      '- README.md: /home/openclaw/project',
    ]);
  });

  it('tolerates unreadable or deleted files', async () => {
    const exitCode = await runPublicArtifactCheck({
      args: ['README.md', 'SECURITY.md'],
      readTextFile: async (filePath) => {
        if (filePath === 'README.md') {
          throw new Error('file disappeared');
        }
        return '# clean public docs\n';
      },
      writeError: () => {
        throw new Error('should not write errors for unreadable clean run');
      },
    });

    expect(exitCode).toBe(0);
  });
});
