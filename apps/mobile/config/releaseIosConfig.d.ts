export declare function withReleaseIosConfig<T extends { ios?: Record<string, unknown> }>(
  config: T,
  env: Readonly<Record<string, string | undefined>>,
): T & { ios?: { appleTeamId?: string; buildNumber?: string } };
