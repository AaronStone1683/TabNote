const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const cached = new Map();
let apiCalls = 0;
let saved = 0;
const context = {
  URL, AbortController, setTimeout, clearTimeout, console,
  TabnoteDecisionStore: {
    getMany: async (_title, tasks) => new Map(tasks.filter((task) => cached.has(task.id))
      .map((task) => [task.id, cached.get(task.id)])),
    putMany: async (_title, scores) => {
      saved += scores.length;
      for (const { task, score } of scores) cached.set(task.id, score);
    }
  },
  fetch: async () => {
    apiCalls++;
    return { ok: true, json: async () => ({ answers: { task_0: { noul: 0.91 } } }) };
  }
};
vm.runInNewContext(fs.readFileSync(path.join(__dirname, "..", "typesafe.js"), "utf8"), context);
const classify = context.TabnoteTypeSafe.classify;
const jev = [{ id: "jev", name: "JEV" }];

(async () => {
  assert.equal(await classify("Documentation", jev, null, "https://docs.jev.ai/start"), "jev",
    "an exact hostname label matches the task without an API key");
  assert.equal(await classify("", jev, null, "https://jev.ai/"), "jev",
    "a finished page with no title can still match by hostname");
  assert.equal(await classify("JEV API guide", jev, null, "https://typesafe.ai/guide"), "jev",
    "a whole title term also matches");
  assert.equal(await classify("Jeverson profile", jev, null, "https://example.org/"), null,
    "a task name embedded in a longer English word is not enough");
  assert.equal(await classify("Homepage", jev, null, "https://notjev.ai/"), null,
    "a hostname substring is not enough");
  assert.equal(await classify("CVPR2027 guidelines", [{ id: "cvpr", name: "CVPR2027投稿" }], null,
    "https://example.org/"), "cvpr", "generic action words do not block an identifier match");
  assert.equal(await classify("JEV API guide", [jev[0], { id: "research", name: "JEV research" }], null,
    "https://example.org/"), null, "equally matching tasks leave the tab ungrouped");
  assert.equal(apiCalls, 0);
  assert.equal(saved, 0, "local rule results must not be stored as API decisions");

  cached.set("jev", 0.2);
  assert.equal(await classify("JEV API guide", jev, null, "https://jev.ai/"), null,
    "a saved API decision takes precedence over local rules");
  cached.clear();
  assert.equal(await classify("Anything", jev, "test-key", "https://example.org/"), "jev");
  assert.equal(apiCalls, 1, "an available key still uses the API for uncached decisions");
  assert.equal(saved, 1);
  console.log("Local task rules, cache priority, and API behavior passed.");
})().catch((error) => { console.error(error); process.exitCode = 1; });
