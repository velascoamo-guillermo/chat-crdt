// app.json holds the config; this only layers the release-only iOS settings
// from the environment on top (config/releaseIosConfig.js).
/* eslint-disable @typescript-eslint/no-require-imports */
const { withReleaseIosConfig } = require('./config/releaseIosConfig');

module.exports = ({ config }) => withReleaseIosConfig(config, process.env);
