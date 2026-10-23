import type { ConfigPlugin } from 'expo/config-plugins';

declare const withQaReadoutBundleCheck: ConfigPlugin;
export default withQaReadoutBundleCheck;
export function addQaReadoutBundleCheck(buildGradle: string): string;
