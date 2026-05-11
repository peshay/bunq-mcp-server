import { describe, expect, it } from 'vitest';

import { findPublicArtifactFindings } from '../../src/utils/public-artifact-guard.js';

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

  it('flags Windows absolute paths with backslashes and forward slashes', () => {
    const findings = findPublicArtifactFindings(
      'README.md',
      'Avoid examples like C:\\Users\\alice\\project or C:/Users/alice/project in public docs.',
    );

    expect(findings.map((finding) => finding.match)).toEqual([
      'C:\\Users\\alice\\project',
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
});
