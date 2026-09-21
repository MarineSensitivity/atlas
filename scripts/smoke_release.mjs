#!/usr/bin/env node
// PLACEHOLDER (repo layout only; not an atlas-0 Deliverable 1-5 item). Once atlas-1 publishes real
// `{ver}/manifest.json` + `app/boot.json` and atlas-9 stands up the preview host, this will smoke a
// published release end-to-end (fetch its manifest, hit each advertised capability's URL once,
// assert the version registry and the app agree on status/access) the way scripts/verify.mjs smokes
// the shell's own layout. Left unimplemented on purpose — there is no release to smoke yet.
process.stderr.write("smoke_release: not implemented yet (see plan atlas-1 / atlas-9)\n");
process.exit(1);
