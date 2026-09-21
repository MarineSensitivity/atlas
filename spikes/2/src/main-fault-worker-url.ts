// atlas-0 Step 4, S2, fix round 2 SEEDED FAULT (committed on purpose): the exact wiring round 1
// reported as "passing" -- `?url` alone, not `?worker&url`. Built as its own entry
// (fault-worker-url.html) so it goes through a REAL `vite build` + `vite preview`, not a runtime
// toggle on the real entry (the worker URL is resolved at build time, so it can't be a `?seed=`
// query-param switch the way the other two seeded faults are).
//
// Do not "fix" this file to use `?worker&url` -- that would defeat the whole point: this is the
// committed proof that e2e/s2.spike.spec.ts's vector-feature-count assertion CAN fail. See
// RESULTS.md "fix round 2" and the "seeded fault: worker asset loaded via ?url" describe block in
// the spec (test.fail()-wrapped, so this failing is the expected, CI-green outcome).
import maplibreWorkerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?url";
import { runApp } from "./app";

runApp(maplibreWorkerUrl);
