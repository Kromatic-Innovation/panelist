import { test } from "node:test";
import assert from "node:assert/strict";
import reviewPack from "../packs/review/index.mjs";
import businessPack from "../packs/business/index.mjs";

const REQUIRED = ["id", "name", "role", "caresAbout", "rewards", "punishes", "quitsWhen"];
const FORBIDDEN = ["age", "employer", "company", "tenure"]; // no demographics-as-steering

for (const [name, pack, size] of [["review", reviewPack, 4], ["business", businessPack, 2]]) {
  test(`${name} pack has ${size} well-formed personas`, () => {
    assert.equal(pack.length, size);
    for (const p of pack) {
      for (const f of REQUIRED) assert.ok(p[f], `${p.id} missing ${f}`);
      for (const f of FORBIDDEN) assert.ok(!(f in p), `${p.id} has forbidden demographic field ${f}`);
      assert.ok(Array.isArray(p.quitsWhen) && p.quitsWhen.length, `${p.id} needs a behavioural kill-condition`);
    }
  });
}

test("persona ids are unique across example packs", () => {
  const ids = [...reviewPack, ...businessPack].map((p) => p.id);
  assert.equal(new Set(ids).size, ids.length);
});
