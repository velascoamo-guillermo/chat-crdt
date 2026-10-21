export function qaReadoutBuildError(input: {
  argv: readonly string[];
  env: Readonly<Record<string, string | undefined>>;
  e2eToken?: string | null;
}): string | null;
