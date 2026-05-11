import { describe, expect, it } from 'vitest';

import {
  findPublicArtifactFindings,
  isPublicArtifactFile,
} from '../../src/utils/public-artifact-guard.js';

describe('public artifact guard', () => {
  it('allows clean public artifacts', () => {
    const findings = findPublicArtifactFindings(
      'README.md',
      '# bunq MCP\n\n[docs](docs/setup.md)\n',
    );

    expect(findings).toEqual([]);
  });

  it('flags local absolute paths and OpenClaw workspace paths', () => {
    const findings = findPublicArtifactFindings(
      'README.md',
      'See /Users/ahu/git/projects/bunq-mcp-server and /home/openclaw/.openclaw/workspace-monkey',
    );

    expect(findings.map((finding) => finding.match)).toEqual([
      '/Users/ahu/git/projects/bunq-mcp-server',
      '/home/openclaw/.openclaw/workspace-monkey',
    ]);
  });

  it('flags Windows local-user paths with backslashes', () => {
    const findings = findPublicArtifactFindings(
      'README.md',
      'Avoid examples like C:\\Users\\alice\\project in public docs.',
    );

    expect(findings.map((finding) => finding.match)).toEqual([
      'C:\\Users\\alice\\project',
    ]);
  });

  it('flags Windows absolute paths with backslashes and forward slashes', () => {
    const findings = findPublicArtifactFindings(
      'README.md',
      'Avoid examples like D:\\tmp\\project or C:/Users/alice/project in public docs.',
    );

    expect(findings.map((finding) => finding.match)).toEqual([
      'D:\\tmp\\project',
      'C:/Users/alice/project',
    ]);
  });

  it('does not mistake URL schemes or mount delimiters for Windows paths', () => {
    const findings = findPublicArtifactFindings(
      'README.md',
      '[ci](https://github.com/peshay/bunq-mcp-server) and -v "$(pwd)/data:/app/data"',
    );

    expect(findings).toEqual([]);
  });

  it('ignores private paths in non-public artifacts', () => {
    const findings = findPublicArtifactFindings(
      'src/index.ts',
      'const fixture = "/home/openclaw/private/worktree";',
    );

    expect(findings).toEqual([]);
  });

  it('recognizes the configured public artifact file set', () => {
    expect(isPublicArtifactFile('ARCHITECTURE.md')).toBe(true);
    expect(isPublicArtifactFile('docker-compose.example.yml')).toBe(true);
    expect(isPublicArtifactFile('.github/workflows/ci.yml')).toBe(true);
    expect(isPublicArtifactFile('examples/openclaw.mcp.json')).toBe(true);
    expect(isPublicArtifactFile('src/index.ts')).toBe(false);
  });

  it('flags file URLs and private var paths', () => {
    const findings = findPublicArtifactFindings(
      'SECURITY.md',
      'Do not publish file:///home/openclaw/project or /private/var/folders/runtime details.',
    );

    expect(findings.map((finding) => finding.match)).toEqual([
      'file:///home/openclaw/project',
      '/private/var/folders/runtime',
    ]);
  });
});
