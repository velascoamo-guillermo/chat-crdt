export function syncE2eReleaseFiles(
  appDir: string,
  env: Readonly<Record<string, string | undefined>>,
): 'written' | 'removed' | 'untouched';
