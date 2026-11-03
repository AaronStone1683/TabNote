const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const extension = path.join(__dirname, "..");
const context = vm.createContext({ URL, console, setTimeout, clearTimeout });
vm.runInContext(fs.readFileSync(path.join(extension, "task-transfer.js"), "utf8"), context);
const transfer = vm.runInContext("TabnoteTaskTransfer", context);
const payload = { task: "CVPR 2027 submission", tabs: [
  { title: "Paper\twith a newline\ninside", url: "https://example.org/paper?section=1" },
  { title: "中文资料", url: "https://example.org/资料" }
] };
const parsed = transfer.parse(transfer.serialize(payload));
assert.equal(JSON.stringify(parsed), JSON.stringify(payload));
assert.throws(() => transfer.parse("Timestamp (UTC)\tChange\n"), /not a Tabnote/);
assert.throws(() => transfer.parse("Tabnote Task Group v1\nTask: \"x\"\nTabs:\n{bad}"), /malformed/);
assert.throws(() => transfer.validate({ task: "x", tabs: [{ title: "Bad", url: "javascript:alert(1)" }] }), /HTTP\(S\)/);
assert.throws(() => transfer.validate({ task: "x", tabs: [{ title: "Bad", url: "https://user:pass@example.org/" }] }), /credentials/);

const tabs = [{ id: 1, windowId: 7, groupId: 90, url: "https://keep.example/", title: "Keep this group", status: "complete" }];
const groups = [{ id: 90, windowId: 7, title: "My untouched group", color: "blue" }];
const data = { tasks: [], enabled: true, mode: "site" };
const assignments = new Map();
const manuals = new Map();
let nextTabId = 2;
let nextGroupId = 91;
let onMessage;
const chrome = {
  tabs: {
    query: async (filter = {}) => tabs.filter((tab) =>
      (filter.windowId === undefined || tab.windowId === filter.windowId) &&
      (filter.groupId === undefined || tab.groupId === filter.groupId)).map((tab) => ({ ...tab })),
    create: async ({ windowId, url, active }) => {
      const tab = { id: nextTabId++, windowId, groupId: -1, url, title: url, status: "loading", active };
      tabs.push(tab);
      return { ...tab };
    },
    get: async (id) => ({ ...tabs.find((tab) => tab.id === id) }),
    update: async (id, changes) => Object.assign(tabs.find((tab) => tab.id === id), changes),
    group: async ({ groupId, tabIds }) => {
      const id = groupId ?? nextGroupId++;
      if (groupId === undefined) groups.push({ id, windowId: 7, title: "" });
      for (const tabId of tabIds) tabs.find((tab) => tab.id === tabId).groupId = id;
      return id;
    },
    onCreated: { addListener() {} }, onUpdated: { addListener() {} },
    onMoved: { addListener() {} }, onAttached: { addListener() {} }, onRemoved: { addListener() {} }
  },
  tabGroups: {
    query: async (filter) => groups.filter((group) => filter.windowId === undefined || group.windowId === filter.windowId).map((group) => ({ ...group })),
    get: async (id) => ({ ...groups.find((group) => group.id === id) }),
    update: async (id, changes) => Object.assign(groups.find((group) => group.id === id), changes),
    onCreated: { addListener() {} }, onUpdated: { addListener() {} }, onRemoved: { addListener() {} }
  },
  storage: {
    local: { get: async (defaults) => ({ ...defaults, ...data }), set: async (changes) => Object.assign(data, changes) },
    session: { get: async () => ({}) }
  },
  runtime: {
    onMessage: { addListener(listener) { onMessage = listener; } },
    onInstalled: { addListener() {} }, onStartup: { addListener() {} }
  }
};
Object.assign(context, {
  chrome,
  importScripts: () => {},
  TabnoteDecisionStore: {
    getManual: async (ids) => new Map(ids.filter((id) => manuals.has(id)).map((id) => [id, manuals.get(id)])),
    getAssignments: async (urls) => new Map(urls.filter((url) => assignments.has(url)).map((url) => [url, assignments.get(url)])),
    setManual: async (id, groupId) => manuals.set(id, groupId),
    setAssignment: async (url, taskId) => assignments.set(url, taskId)
  }
});
vm.runInContext(fs.readFileSync(path.join(extension, "background.js"), "utf8"), context);
function command(message) { return new Promise((resolve) => onMessage(message, {}, resolve)); }

(async () => {
  const imported = await command({ type: "importTaskGroup", payload, windowId: 7 });
  assert.equal(imported.ok, true, imported.error);
  assert.equal(imported.summary.count, 2);
  assert.equal(data.tasks.length, 1);
  assert.equal(groups[0].title, "My untouched group");
  assert.equal(tabs[0].groupId, 90);
  assert.equal(groups[1].title, "📌 CVPR 2027 submission");
  assert.equal(tabs[1].groupId, groups[1].id);
  assert.equal(tabs[2].groupId, groups[1].id);
  assert.equal(assignments.get(payload.tabs[0].url), data.tasks[0].id);
  assert.equal(manuals.get(tabs[1].id), groups[1].id);
  const exported = await command({ type: "exportTaskGroup", taskId: data.tasks[0].id });
  assert.equal(exported.ok, true, exported.error);
  assert.equal(exported.summary.tabs.length, 2);
  const importedAgain = await command({ type: "importTaskGroup", payload, windowId: 7 });
  assert.equal(importedAgain.ok, true, importedAgain.error);
  assert.equal(data.tasks.length, 1);
  assert.equal(groups.length, 2);
  assert.equal(tabs.filter((tab) => tab.groupId === groups[1].id).length, 4);
  assert.equal((await command({ type: "importTaskGroup", payload: { task: "Bad", tabs: [{ title: "x", url: "file:///etc/passwd" }] }, windowId: 7 })).ok, false);
  console.log("Task group TXT round trip, import, reuse, and isolation checks passed.");
})().catch((error) => { console.error(error); process.exitCode = 1; });
