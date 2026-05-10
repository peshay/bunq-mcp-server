export interface PublicArtifactFinding {
  filePath: string;
  pattern: string;
  match: string;
}

const PUBLIC_ARTIFACT_PATH_PATTERNS = [
  /file:\/\/\/[^\s"'`<>]+/g,
  /(?<![A-Za-z])[A-Za-z]:[\\/][^\s"'`<>]+/g,
  /\/Users\/[^\s"'`<>]+/g,
  /\/home\/openclaw\/[^\s"'`<>]+/g,
  /\/home\/[^\s"'`<>]+/g,
  /\/private\/var\/[^\s"'`<>]+/g,
  /\.openclaw\/[^\s"'`<>]+/g,
];

const PUBLIC_ARTIFACT_FILES = [
  /^(README|ARCHITECTURE|CONTRIBUTING|SECURITY)\.md$/,
  /^docker-compose\.example\.yml$/,
  /^package\.json$/,
  /^\.github\/.*\.(yml|yaml)$/,
  /^examples\/.*\.json$/,
];

export function isPublicArtifactFile(filePath: string): boolean {
  return PUBLIC_ARTIFACT_FILES.some((pattern) => pattern.test(filePath));
}

export function findPublicArtifactFindings(
  filePath: string,
  content: string,
): PublicArtifactFinding[] {
  if (!isPublicArtifactFile(filePath)) {
    return [];
  }

  const findings: PublicArtifactFinding[] = [];
  const seenSpans: Array<[number, number]> = [];

  for (const pattern of PUBLIC_ARTIFACT_PATH_PATTERNS) {
    pattern.lastIndex = 0;
    for (const match of content.matchAll(pattern)) {
      const value = match[0];
      const start = match.index;
      const end = start + value.length;
      const overlaps = seenSpans.some(([seenStart, seenEnd]) => start < seenEnd && end > seenStart);
      if (overlaps) {
        continue;
      }

      seenSpans.push([start, end]);
      findings.push({
        filePath,
        pattern: pattern.source,
        match: value,
      });
    }
  }

  return findings;
}
