import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { PANELIST_VERSION } from "../src/index.mjs";

// package.json is read via createRequire rather than fs or an import
// attribute (`with { type: "json" }`) — this is the most robust form on the
// repo's Node floor (engines: >=20, CI pins node 20) and keeps the repo's
// zero `fs`-in-src/test footprint intact.
const require = createRequire(import.meta.url);
const pkg = require("../package.json");

test("PANELIST_VERSION matches package.json version", () => {
  assert.equal(
    PANELIST_VERSION,
    pkg.version,
    `PANELIST_VERSION ("${PANELIST_VERSION}") has drifted from package.json's version ("${pkg.version}")`,
  );
});
