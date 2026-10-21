// Config plugin: an Android release can never ship the e2e build's JS bundle.
//
// The RN Gradle bundle task (createBundleReleaseJsAndAssets) is incremental
// over the JS sources only; env vars aren't inputs. So after build-e2e.sh, a
// plain assembleRelease with no JS change reused the e2e bundle (QA readout,
// localhost API) and Metro, where config/qaReadoutGuard.js runs, never started.
// This appends to android/app/build.gradle:
//   - the QA flag and the e2e token as task inputs, so a change of either
//     re-bundles;
//   - a fail-closed check after the task: a release bundle carrying the QA
//     readout marker fails unless this is the e2e build, and an e2e bundle
//     without the marker fails too (so the check can't go silently blind).
// iOS needs neither: its bundle phase always runs, through the Metro guard.

/* eslint-disable @typescript-eslint/no-require-imports */
const {
  E2E_TOKEN_FILE,
  MIN_TOKEN_LENGTH,
  QA_READOUT_BUNDLE_MARKER,
} = require('./e2eBuildToken');

const BEGIN = '// @chatcrdt-qa-readout-bundle-check begin (config/withQaReadoutBundleCheck.js)';
const END = '// @chatcrdt-qa-readout-bundle-check end';

// The doLast closure captures `bundleTask` (a Task). Gradle's configuration
// cache rejects that: if org.gradle.configuration-cache is ever enabled, move
// the check into a task-free closure (read the bundle path into a provider at
// configuration time) or a dedicated task.
const gradleBlock = () => `${BEGIN}
def chatcrdtQaReadout = providers.environmentVariable("EXPO_PUBLIC_QA_READOUT").orElse("")
def chatcrdtE2eBuild = providers.environmentVariable("CHATCRDT_E2E_BUILD").orElse("")
def chatcrdtE2eTokenFile = new File(rootDir, "../${E2E_TOKEN_FILE}")
tasks.matching { it.name ==~ /createBundle.*ReleaseJsAndAssets/ }.configureEach { bundleTask ->
    bundleTask.inputs.property("chatcrdtQaReadout", chatcrdtQaReadout)
    bundleTask.inputs.property("chatcrdtE2eBuild", chatcrdtE2eBuild)
    bundleTask.doLast {
        def token = chatcrdtE2eTokenFile.exists() ? chatcrdtE2eTokenFile.text.trim() : ""
        def isE2e = token.length() >= ${MIN_TOKEN_LENGTH} && chatcrdtE2eBuild.get() == token
        def bundle = bundleTask.jsBundleDir.get().file(bundleTask.bundleAssetName.get()).asFile
        def hasQaReadout = new String(bundle.bytes, "ISO-8859-1").contains("${QA_READOUT_BUNDLE_MARKER}")
        if (hasQaReadout && !isE2e) {
            throw new GradleException("$bundle carries the QA readout (EXPO_PUBLIC_QA_READOUT=1) but this is not the e2e build. Unset EXPO_PUBLIC_QA_READOUT and rebuild.")
        }
        if (isE2e && !hasQaReadout) {
            throw new GradleException("e2e build: $bundle lacks the QA readout marker. The release check in config/withQaReadoutBundleCheck.js would be blind; fix the marker in app/(chat)/[roomId].tsx.")
        }
    }
}
${END}
`;

/**
 * build.gradle with the check appended once.
 * @param {string} buildGradle
 * @returns {string}
 */
function addQaReadoutBundleCheck(buildGradle) {
  if (buildGradle.includes(BEGIN)) {
    return buildGradle;
  }
  const separator = buildGradle.endsWith('\n') ? '\n' : '\n\n';
  return `${buildGradle}${separator}${gradleBlock()}`;
}

const withQaReadoutBundleCheck = (config) => {
  const { withAppBuildGradle } = require('expo/config-plugins');
  return withAppBuildGradle(config, (modConfig) => {
    modConfig.modResults.contents = addQaReadoutBundleCheck(modConfig.modResults.contents);
    return modConfig;
  });
};

module.exports = withQaReadoutBundleCheck;
module.exports.addQaReadoutBundleCheck = addQaReadoutBundleCheck;
