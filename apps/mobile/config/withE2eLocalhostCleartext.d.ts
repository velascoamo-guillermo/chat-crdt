export function syncE2eReleaseFiles(
  appDir: string,
  env: Readonly<Record<string, string | undefined>>,
  e2eToken: string | null,
): 'written' | 'removed' | 'untouched';
