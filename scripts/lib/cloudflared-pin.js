'use strict';
// The cloudflared connector bundled with the macOS app — pinned. 2.0.0 shipped WITHOUT it (Cloud Access dead, Cloudflare error 1033), so a mac build that
// lacks it, carries another file, or whose binary does not run is refused by prebuild-checks, afterPack and verify-mac-build.
//
// Source: the official Cloudflare release 2026.10.0, cloudflared-darwin-arm64 (checksum equals the one in Cloudflare's release notes),
// signed "Developer ID Application: Cloudflare Inc. (68WVV388M8)". Apache-2.0 (LICENSE of cloudflared) — committing the binary is fine.
// To move to another release: put the new binary through scripts/prepare-cloudflared-mac.js after updating these values from the release notes.
const path = require('path');

module.exports = {
  version: '2026.10.0',
  mac: {
    arch: 'arm64',
    sha256: '72edfd3eea463aef4d5cb89e2e209cecb048cc756c2b01915de2e0ad7cb39830',
    bytes: 39364384,
    authority: 'Developer ID Application: Cloudflare Inc. (68WVV388M8)',
    teamId: '68WVV388M8',
    /** repo path of the bundled file (copied by electron-builder into <app>/Contents/Resources/bin/cloudflared/cloudflared) */
    repoPath: path.join(__dirname, '..', '..', 'bin', 'macos-arm64', 'cloudflared', 'cloudflared'),
  },
};
