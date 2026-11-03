const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const backgroundPath = path.join(__dirname, "..", "background.js");

const tabs = [
  { id: 1, windowId: 7, title: "A title", url: "https://a.test/", status: "complete", groupId: -1 },
  { id: 2, windowId: 7, title: "B title", url: "https://b.test/", status: "complete", groupId: -1 },
  { id: 3, windowId: 7, title: "Manual title", url: "https://c.test/", status: "complete", groupId: 99 },
  { id: 4, windowId: 7, title: "A title", url: "https://d.test/", status: "complete", groupId: 11 }
];
const groups = [{ id: 99, windowId: 7, title: "Manual" }, { id: 11, windowId: 7, title: "🌐 d.test" }];
let nextGroup = 100;
let nextTab = 1000;
let settings = { enabled: true, mode: "site", tasks: [{ id: "a", name: "Task A" }, { id: "b", name: "Task B" }] };
let sessionApiKey = "test-key";
let messageListener;
let onCreatedListener;
let onRemovedListener;
let onUpdatedListener;
let onMovedListener;
let onAttachedListener;
let onGroupUpdatedListener;
let onGroupRemovedListener;
let onGroupCreatedListener;
let onStartupListener;
const classifications = [];
const deletedDecisions = [];
const manualPlacements = new Map();
const assignments = new Map();
const chrome = {
  storage: {
    local: { get: async (defaults) => ({ ...defaults, ...settings }), set: async (value) => { settings = { ...settings, ...value }; } },
    session: { get: async () => ({ typesafeApiKey: sessionApiKey }) }
  },
  tabs: {
    query: async (filter = {}) => tabs.filter((tab) =>
      (filter.windowId === undefined || tab.windowId === filter.windowId) &&
      (filter.groupId === undefined || tab.groupId === filter.groupId)),
    ungroup: async (ids) => {
      for (const tab of tabs) if ([ids].flat().includes(tab.id) && tab.groupId !== -1) {
        tab.groupId = -1;
        queueMicrotask(() => onUpdatedListener(tab.id, { groupId: -1 }, tab));
      }
    },
    group: async ({ groupId, tabIds }) => {
      const id = groupId ?? nextGroup++;
      for (const tab of tabs) if (tabIds.includes(tab.id) && tab.groupId !== id) {
        tab.groupId = id;
        queueMicrotask(() => onUpdatedListener(tab.id, { groupId: id }, tab));
      }
      if (!groups.some((group) => group.id === id)) groups.push({ id, windowId: 7, title: "" });
      return id;
    },
    create: async ({ windowId, url }) => {
      const tab = { id: nextTab++, windowId, url, title: "", status: "complete", groupId: -1 };
      tabs.push(tab);
      return tab;
    },
    remove: async (ids) => {
      for (const id of [ids].flat()) {
        const index = tabs.findIndex((tab) => tab.id === id);
        if (index < 0) throw new Error(`Tab ${id} no longer exists.`);
        const [tab] = tabs.splice(index, 1);
        queueMicrotask(() => onRemovedListener(tab.id, { windowId: tab.windowId, isWindowClosing: false }));
      }
    },
    get: async (id) => tabs.find((tab) => tab.id === id),
    update: async (id, value) => Object.assign(tabs.find((tab) => tab.id === id), value),
    onCreated: { addListener(fn) { onCreatedListener = fn; } },
    onUpdated: { addListener(fn) { onUpdatedListener = fn; } },
    onMoved: { addListener(fn) { onMovedListener = fn; } },
    onAttached: { addListener(fn) { onAttachedListener = fn; } },
    onRemoved: { addListener(fn) { onRemovedListener = fn; } }
  },
  tabGroups: {
    query: async ({ windowId } = {}) => groups.filter((group) => windowId === undefined || group.windowId === windowId),
    get: async (id) => groups.find((group) => group.id === id),
    update: async (id, value) => {
      const group = Object.assign(groups.find((group) => group.id === id), value);
      queueMicrotask(() => onGroupUpdatedListener?.(group));
      return group;
    },
    onUpdated: { addListener(fn) { onGroupUpdatedListener = fn; } },
    onCreated: { addListener(fn) { onGroupCreatedListener = fn; } },
    onRemoved: { addListener(fn) { onGroupRemovedListener = fn; } }
  },
  runtime: {
    onInstalled: { addListener() {} }, onStartup: { addListener(fn) { onStartupListener = fn; } },
    onMessage: { addListener(fn) { messageListener = fn; } }
  }
};
const context = {
  chrome, URL, Date, Promise, Map, Set, setTimeout, clearTimeout, console,
  importScripts() {},
  TabnoteActivityLog: { recordAdded: async () => {}, recordClosed: async () => {}, updateSnapshot: async () => {}, seedSnapshots: async () => {} },
  TabnoteTaskTransfer: { validate: (payload) => payload, validateSite: (payload) => payload },
  TabnoteDecisionStore: {
    deleteTask: async (id) => deletedDecisions.push(id),
    getAssignments: async (urls) => new Map(urls.filter((url) => assignments.has(url)).map((url) => [url, assignments.get(url)])),
    setAssignment: async (url, taskId) => assignments.set(url, taskId),
    deleteAssignment: async (url) => assignments.delete(url),
    deleteAssignmentsForTask: async (taskId) => {
      for (const [url, id] of assignments) if (id === taskId) assignments.delete(url);
    },
    getManual: async (ids) => new Map(ids.filter((id) => manualPlacements.has(id)).map((id) => [id, manualPlacements.get(id)])),
    getAllManual: async () => [...manualPlacements.values()],
    setManual: async (tabId, groupId, windowId, title = "", url = "") =>
      manualPlacements.set(tabId, { tabId, groupId, windowId, title, url }),
    deleteManual: async (tabId) => manualPlacements.delete(tabId),
    clearManual: async () => manualPlacements.clear()
  },
  TabnoteTypeSafe: { classify: async (title, tasks) => {
    classifications.push({ title, tasks: tasks.map((task) => task.id) });
    return title === "A title" ? "a" : title === "B title" ? "b" :
      title === "Auto Project Page" ? tasks[0]?.id : null;
  } }
};
vm.runInNewContext(fs.readFileSync(backgroundPath, "utf8"), context);
function message(payload) {
  return new Promise((resolve) => messageListener(payload, {}, resolve));
}
(async () => {
  const result = await message({ type: "organizeTask" });
  assert.equal(result.ok, true);
  assert.deepEqual({ checked: result.summary.checked, matched: result.summary.matched }, { checked: 2, matched: 2 });
  assert.equal(settings.mode, "task");
  assert.equal(tabs[3].groupId, 11, "By Task must leave existing website groups in place");
  assert.notEqual(tabs[0].groupId, tabs[1].groupId);
  assert.equal(tabs[2].groupId, 99);
  assert.equal(groups.find((group) => group.id === 11).title, "d",
    "legacy site group uses the short site name while retaining its full hostname identity");
  await chrome.tabGroups.update(11, { title: "My D pages", color: "orange" });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal((await message({ type: "listSiteGroups" })).summary.find((row) => row.id === 11).label,
    "My D pages", "manual site rename stays connected to the website identity");
  assert.equal(groups.find((group) => group.id === tabs[0].groupId).title, "📌 Task A");
  assert.equal(groups.find((group) => group.id === tabs[1].groupId).title, "📌 Task B");
  assert.equal(classifications.length, 2);
  assert.equal(manualPlacements.size, 0, "plugin-created grouping must not be recorded as manual");

  const originalGroupIds = tabs.map((tab) => tab.groupId);
  settings.tasks.push({ id: "c", name: "Task C" });
  const again = await message({ type: "organizeTask" });
  assert.equal(again.ok, true);
  assert.equal(again.summary.checked, 0, "grouped tabs are not reclassified after task addition");
  assert.equal(classifications.length, 2);
  assert.deepEqual(tabs.map((tab) => tab.groupId), originalGroupIds);

  const renamed = await message({ type: "renameTask", taskId: "a", name: "Renamed Task A" });
  assert.equal(renamed.ok, true);
  assert.equal(tabs[0].groupId, originalGroupIds[0]);
  assert.equal(groups.find((group) => group.id === tabs[0].groupId).title, "📌 Renamed Task A");
  await chrome.tabGroups.update(tabs[0].groupId, { title: "My task pages", color: "green" });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal((await message({ type: "exportTaskGroup", taskId: "a" })).ok, true,
    "task export still finds the group after a manual rename and color change");
  assert.equal(classifications.length, 2);
  assert.deepEqual(deletedDecisions, ["a"]);

  tabs.push({ id: 5, windowId: 7, title: "New title", url: "https://e.test/", status: "complete", groupId: -1 });
  const withNewTab = await message({ type: "organizeTask" });
  assert.equal(withNewTab.ok, true);
  assert.equal(withNewTab.summary.checked, 1);
  assert.equal(classifications.length, 3);
  assert.deepEqual(classifications[2].tasks, ["a", "b", "c"]);

  tabs.push({ id: 8, windowId: 7, title: "Another D page", url: "https://d.test/another", status: "complete", groupId: -1 });
  const websiteOnly = await message({ type: "organizeSite" });
  assert.equal(websiteOnly.ok, true);
  assert.equal(tabs.find((tab) => tab.id === 8).groupId, 11, "new website tab joins an existing website group");
  assert.equal(tabs[0].groupId, originalGroupIds[0], "By Website must preserve existing task groups");
  assert.equal(tabs[1].groupId, originalGroupIds[1], "By Website must preserve other task groups");
  tabs.push(
    { id: 30, windowId: 7, title: "Site X 1", url: "https://x.test/1", status: "complete", groupId: -1, favIconUrl: "https://x.test/favicon.ico" },
    { id: 31, windowId: 7, title: "Site X 2", url: "https://x.test/2", status: "complete", groupId: -1 },
    { id: 32, windowId: 7, title: "Site Y 1", url: "https://y.test/1", status: "complete", groupId: -1 },
    { id: 33, windowId: 7, title: "Site Y 2", url: "https://y.test/2", status: "complete", groupId: -1 }
  );
  assert.equal((await message({ type: "organizeSite" })).ok, true);
  const siteRows = (await message({ type: "listSiteGroups" })).summary;
  assert.equal(siteRows.find((row) => row.site === "x.test").favicon, "https://x.test/favicon.ico");
  assert.equal(siteRows.find((row) => row.site === "x.test").count, 2);
  assert.notEqual(siteRows.find((row) => row.site === "x.test").color,
    siteRows.find((row) => row.site === "y.test").color, "new site groups should use different colors while choices remain");
  assert.equal(siteRows.some((row) => row.site === "Manual"), false, "manually created groups stay out of the Sites list");
  tabs.push({ id: 9, windowId: 7, title: "A title", url: "https://new-a.test/", status: "complete", groupId: -1 });
  const taskOnly = await message({ type: "organizeTask" });
  assert.equal(taskOnly.ok, true);
  assert.equal(tabs.find((tab) => tab.id === 9).groupId, originalGroupIds[0],
    "new task tab joins an existing task group");
  assert.equal(tabs.find((tab) => tab.id === 8).groupId, 11, "By Task must preserve existing website groups");

  settings.mode = "site";
  const taskGroupIds = tabs.slice(0, 4).map((tab) => tab.groupId);
  const blank = { id: 6, windowId: 7, title: "New Tab", url: "chrome://newtab/", status: "complete", groupId: -1 };
  tabs.push(blank);
  onCreatedListener(blank);
  await new Promise((resolve) => setTimeout(resolve, 700));
  assert.deepEqual(tabs.slice(0, 4).map((tab) => tab.groupId), taskGroupIds,
    "automatic website sorting must not undo manually assigned task groups when Chrome creates a blank tab");
  tabs.splice(tabs.indexOf(blank), 1);
  onRemovedListener(blank.id, { windowId: 7, isWindowClosing: false });
  await new Promise((resolve) => setTimeout(resolve, 700));
  assert.deepEqual(tabs.slice(0, 4).map((tab) => tab.groupId), taskGroupIds,
    "closing the blank tab must not undo task groups");

  tabs[3].groupId = -1;
  onUpdatedListener(tabs[3].id, { groupId: -1 }, tabs[3]);
  await new Promise((resolve) => setTimeout(resolve, 0));
  const afterManualUngroup = await message({ type: "organizeTask" });
  assert.equal(afterManualUngroup.ok, true);
  assert.equal(tabs[3].groupId, -1, "manual ungrouping must not be reversed by task sorting");

  const manualTab = { id: 7, windowId: 7, title: "Manual placement", url: "https://manual.test/", status: "complete", groupId: -1 };
  tabs.push(manualTab);
  manualTab.groupId = taskGroupIds[0];
  onUpdatedListener(manualTab.id, { groupId: manualTab.groupId }, manualTab);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(manualPlacements.get(manualTab.id).groupId, taskGroupIds[0]);

  const removed = await message({ type: "removeTask", taskId: "a" });
  assert.equal(removed.ok, true);
  assert.equal(manualTab.groupId, -1, "removing a task must ungroup manually placed tabs");
  assert.equal(manualPlacements.has(manualTab.id), false, "deleted task must clear its manual placement record");
  assert.equal(tabs[0].groupId, -1, "removing a task should ungroup automatically placed tabs");
  const explicitWebsite = await message({ type: "organizeSite" });
  assert.equal(explicitWebsite.ok, true);
  assert.equal(manualTab.groupId, -1, "deleted task group must stay removed");
  assert.equal(tabs[1].groupId, taskGroupIds[1], "explicit website sorting must preserve remaining task groups");
  const restored = await message({ type: "restoreTabs" });
  assert.equal(restored.ok, true, JSON.stringify(restored));
  assert.equal(manualTab.groupId, -1, "Restore Tabs may remove the manual membership");
  assert.equal(tabs[2].groupId, -1, "Reset also removes groups that existed before Tabnote was installed");
  assert.equal(manualPlacements.size, 0);
  manualPlacements.set(999, { tabId: 999, groupId: -1, windowId: 7,
    title: manualTab.title, url: manualTab.url });
  onStartupListener();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(manualPlacements.has(999), false);
  assert.equal(manualPlacements.has(manualTab.id), true,
    "startup should reconnect a manual placement when Chrome changes the tab ID");
  tabs.splice(0, tabs.length,
    { id: 10, windowId: 7, title: "A title", url: "https://a.test/", status: "complete", groupId: 300 },
    { id: 11, windowId: 7, title: "A title", url: "https://b.test/", status: "complete", groupId: -1 },
    { id: 12, windowId: 7, title: "A title", url: "https://c.test/", status: "complete", groupId: -1 },
    { id: 13, windowId: 7, title: "B title", url: "https://d.test/", status: "complete", groupId: -1 },
    { id: 14, windowId: 7, title: "A title", url: "https://e.test/", status: "complete", groupId: 301 });
  groups.splice(0, groups.length,
    { id: 300, windowId: 7, title: "📌 Task A" },
    { id: 301, windowId: 7, title: "Manual" });
  manualPlacements.clear();
  manualPlacements.set(12, { tabId: 12, groupId: -1, windowId: 7 });
  settings = { enabled: false, mode: "site", tasks: [{ id: "a", name: "Task A" }, { id: "b", name: "Task B" }] };
  onGroupUpdatedListener(groups[0]);
  await new Promise((resolve) => setTimeout(resolve, 0));
  const classificationCount = classifications.length;
  const oneTask = await message({ type: "organizeOneTask", taskId: "a" });
  assert.equal(oneTask.ok, true);
  assert.deepEqual({ checked: oneTask.summary.checked, matched: oneTask.summary.matched }, { checked: 2, matched: 1 });
  assert.deepEqual(classifications.slice(classificationCount).map((item) => item.tasks), [["a"], ["a"]]);
  assert.equal(tabs[1].groupId, 300, "matching ungrouped tab joins existing task group");
  assert.equal(tabs[2].groupId, -1, "manually ungrouped tab stays ungrouped");
  assert.equal(tabs[3].groupId, -1, "unmatched tab stays ungrouped");
  assert.equal(tabs[4].groupId, 301, "unrelated group stays untouched");
  assert.equal(settings.mode, "site", "one-task action must not change automatic mode");
  assert.equal(settings.enabled, false, "one-task action must not enable automatic sorting");
  assert.equal((await message({ type: "organizeOneTask", taskId: "missing" })).ok, false);
  tabs.splice(0, tabs.length,
    { id: 20, windowId: 7, title: "Manually chosen page", url: "https://chosen.test/page", status: "complete", groupId: -1 });
  groups.splice(0, groups.length, { id: 400, windowId: 7, title: "📌 Task A" });
  manualPlacements.clear();
  assignments.clear();
  settings = { enabled: false, mode: "site", tasks: [{ id: "a", name: "Task A" }, { id: "b", name: "Task B" }] };
  onGroupUpdatedListener(groups[0]);
  await new Promise((resolve) => setTimeout(resolve, 0));
  tabs[0].groupId = 400;
  onUpdatedListener(20, { groupId: 400 }, tabs[0]);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(assignments.get(tabs[0].url), "a", "manual task placement must save the page-to-task preference");
  assignments.clear();
  settings.taskAssignmentsMigrated = false;
  await message({ type: "restoreTabs" });
  assert.equal(tabs[0].groupId, -1);
  assert.equal(assignments.get(tabs[0].url), "a", "upgrade must recover older manual placements before Restore Tabs clears them");
  const beforeManualReuse = classifications.length;
  sessionApiKey = null;
  const byTaskAgain = await message({ type: "organizeTask" });
  assert.equal(byTaskAgain.ok, true);
  assert.equal(groups.find((group) => group.id === tabs[0].groupId).title, "📌 Task A");
  assert.equal(classifications.length, beforeManualReuse, "By Task must reuse manual preference without API classification");
  await message({ type: "restoreTabs" });
  const wrongTask = await message({ type: "organizeOneTask", taskId: "b" });
  assert.equal(wrongTask.ok, true);
  assert.equal(tabs[0].groupId, -1, "another task's Sort button must respect the manual task choice");
  const rightTask = await message({ type: "organizeOneTask", taskId: "a" });
  assert.equal(rightTask.ok, true);
  assert.equal(groups.find((group) => group.id === tabs[0].groupId).title, "📌 Task A");
  assert.equal(classifications.length, beforeManualReuse, "single-task Sort must reuse manual preference without API classification");
  sessionApiKey = "test-key";
  tabs[0].groupId = -1;
  onUpdatedListener(20, { groupId: -1 }, tabs[0]);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(assignments.has(tabs[0].url), false, "manual ungrouping must remove the remembered task choice");
  await message({ type: "restoreTabs" });
  const afterRemovingPreference = await message({ type: "organizeOneTask", taskId: "a" });
  assert.equal(afterRemovingPreference.ok, true);
  assert.equal(tabs[0].groupId, -1, "removed manual preference must not be restored by task sorting");
  assert.equal(classifications.length, beforeManualReuse + 1, "page without a manual preference returns to classifier");
  tabs.splice(0, tabs.length,
    { id: 40, windowId: 7, title: "One", url: "https://switch.test/one", status: "complete", groupId: -1, favIconUrl: "https://switch.test/favicon.ico" },
    { id: 41, windowId: 7, title: "Two", url: "https://switch.test/two", status: "complete", groupId: -1 });
  groups.splice(0, groups.length);
  settings = { enabled: false, autoSite: false, mode: "site", tasks: [] };
  assert.equal((await message({ type: "popupGroups" })).summary.autoSite, false);
  assert.equal((await message({ type: "setAutoSite", enabled: true })).ok, true);
  assert.equal(settings.autoSite, true);
  const siteId = tabs[0].groupId;
  assert.equal(tabs[1].groupId, siteId, "turning on the switch groups existing website tabs first");
  assert.equal(groups.find((group) => group.id === siteId).title, "switch",
    "new website groups use the second-to-last hostname segment");
  assert.equal((await message({ type: "exportSiteGroup", groupId: siteId })).summary.tabs.length, 2);
  assert.equal((await message({ type: "renameSiteGroup", groupId: siteId, name: "My website" })).ok, true);
  await chrome.tabGroups.update(siteId, { color: "pink" });
  vm.runInNewContext(fs.readFileSync(backgroundPath, "utf8"), { ...context });
  assert.equal((await message({ type: "popupGroups" })).summary.sites.find((row) => row.id === siteId).label,
    "My website", "group identity survives a service worker restart after a manual rename");
  tabs.push({ id: 42, windowId: 7, title: "Three", url: "https://switch.test/three", status: "complete", groupId: -1 });
  onCreatedListener(tabs[2]);
  await new Promise((resolve) => setTimeout(resolve, 700));
  assert.equal(tabs[2].groupId, siteId, "automatic grouping reuses a manually renamed and recolored site group");
  assert.equal((await message({ type: "setAutoSite", enabled: false })).ok, true);
  tabs.push({ id: 43, windowId: 7, title: "Four", url: "https://switch.test/four", status: "complete", groupId: -1 });
  onCreatedListener(tabs[3]);
  await new Promise((resolve) => setTimeout(resolve, 700));
  assert.equal(tabs[3].groupId, -1, "switching off stops automatic site grouping");
  assert.equal((await message({ type: "sortOneSite", groupId: siteId })).ok, true);
  assert.equal(tabs[3].groupId, siteId, "site Sort button works while automatic grouping is off");
  assert.equal((await message({ type: "removeSiteGroup", groupId: siteId })).ok, true);
  assert.equal(tabs[0].groupId, -1, "site remove ungroups automatically placed tabs");
  const imported = await message({ type: "importSiteGroup", windowId: 7, payload: {
    site: "shared.test", label: "Shared pages", tabs: [{ title: "Shared", url: "https://shared.test/page" }]
  } });
  assert.equal(imported.ok, true, JSON.stringify(imported));
  const importedTab = tabs.find((tab) => tab.url === "https://shared.test/page");
  assert.equal(groups.find((group) => group.id === importedTab.groupId).title, "Shared pages");
  const importedGroupId = importedTab.groupId;
  const removedImported = await message({ type: "removeSiteGroup", groupId: importedGroupId });
  assert.equal(removedImported.ok, true);
  assert.equal(importedTab.groupId, importedGroupId, "site remove preserves manually imported tabs");
  assert.equal((await message({ type: "popupGroups" })).summary.sites.some((row) => row.id === importedGroupId), false);
  assert.equal((await message({ type: "restoreTabs" })).ok, true);
  assert.equal(importedTab.groupId, -1, "Reset Groups still removes detached manual groups");
  tabs.splice(0, tabs.length,
    { id: 60, windowId: 7, title: "Google result", url: "https://google.test/search", status: "complete", groupId: -1 },
    { id: 61, windowId: 7, title: "Google page", url: "https://google.test/other", status: "complete", groupId: -1 });
  groups.splice(0, groups.length);
  assert.equal((await message({ type: "setAutoSite", enabled: true })).ok, true);
  const googleGroup = tabs[0].groupId;
  tabs[0].url = "https://github.test/project";
  onUpdatedListener(60, { url: tabs[0].url }, tabs[0]);
  await new Promise((resolve) => setTimeout(resolve, 700));
  assert.equal(tabs[0].groupId, -1, "a cross-site navigation leaves its old automatic site group");
  assert.equal(tabs[1].groupId, googleGroup, "other tabs remain in the original site group");
  const secondGithub = { id: 62, windowId: 7, title: "GitHub issue", url: "https://github.test/issue", status: "complete", groupId: -1 };
  tabs.push(secondGithub);
  onCreatedListener(secondGithub);
  await new Promise((resolve) => setTimeout(resolve, 700));
  assert.equal(tabs[0].groupId, secondGithub.groupId, "navigated tab joins the new site when another matching tab exists");
  assert.equal(groups.find((group) => group.id === secondGithub.groupId).title, "github");
  const manualSiteTab = { id: 63, windowId: 7, title: "Chosen", url: "https://other.test/", status: "complete", groupId: -1 };
  tabs.push(manualSiteTab);
  await chrome.tabs.group({ groupId: googleGroup, tabIds: [manualSiteTab.id] });
  await new Promise((resolve) => setTimeout(resolve, 0));
  manualSiteTab.url = "https://another.test/";
  onUpdatedListener(manualSiteTab.id, { url: manualSiteTab.url }, manualSiteTab);
  await new Promise((resolve) => setTimeout(resolve, 700));
  assert.equal(manualSiteTab.groupId, googleGroup, "manual group placement remains authoritative across navigation");
  assert.equal((await message({ type: "setAutoSite", enabled: false })).ok, true);
  secondGithub.url = "https://example.test/";
  onUpdatedListener(secondGithub.id, { url: secondGithub.url }, secondGithub);
  await new Promise((resolve) => setTimeout(resolve, 700));
  assert.equal(secondGithub.groupId, -1, "cross-site navigation still leaves the old group when auto grouping is off");
  tabs.splice(0, tabs.length);
  groups.splice(0, groups.length);
  manualPlacements.clear();
  settings = { enabled: false, autoSite: false, mode: "site", tasks: [], ownedGroupsV1: [] };
  sessionApiKey = null;
  vm.runInNewContext(fs.readFileSync(backgroundPath, "utf8"), { ...context });
  const added = await message({ type: "addTask", name: "Manual Project", windowId: 7 });
  assert.equal(added.ok, true, JSON.stringify(added));
  assert.equal(settings.tasks[0].name, "Manual Project");
  const placeholder = tabs.find((tab) => tab.groupId === added.summary.groupId);
  assert.equal(placeholder.url, "about:blank", "adding a task creates a blank tab in its group without an API key");
  vm.runInNewContext(fs.readFileSync(backgroundPath, "utf8"), { ...context });
  const realTab = { id: 64, windowId: 7, title: "Useful page", url: "https://manual.test/page", status: "complete", groupId: -1 };
  tabs.push(realTab);
  realTab.groupId = added.summary.groupId;
  onMovedListener(realTab.id, { windowId: 7, fromIndex: 1, toIndex: 2 });
  await new Promise((resolve) => setTimeout(resolve, 200));
  assert.equal(tabs.some((tab) => tab.id === placeholder.id), false,
    "moving a real page into a task group closes the placeholder even without an onUpdated event");
  assert.equal(realTab.groupId, added.summary.groupId, "manual page remains in the task group");
  assert.equal(manualPlacements.get(realTab.id).groupId, added.summary.groupId,
    "moving a tab into a new task group records the manual decision even without onUpdated");
  const otherTask = await message({ type: "addTask", name: "Other Task", windowId: 7 });
  const otherPlaceholder = tabs.find((tab) => tab.groupId === otherTask.summary.groupId);
  assert.equal((await message({ type: "removeTask", taskId: added.summary.task.id })).ok, true);
  assert.equal(realTab.groupId, -1, "deleting the task ungroups its manually moved page");
  assert.equal(tabs.some((tab) => tab.id === realTab.id), true, "deleting the task keeps the page open");
  assert.equal(otherPlaceholder.groupId, otherTask.summary.groupId, "deleting one task leaves other task groups intact");
  const popupReconcile = await message({ type: "addTask", name: "Popup Reconcile", windowId: 7 });
  const popupPlaceholder = tabs.find((tab) => tab.groupId === popupReconcile.summary.groupId);
  realTab.groupId = popupReconcile.summary.groupId;
  assert.equal((await message({ type: "popupGroups" })).ok, true);
  assert.equal(tabs.some((tab) => tab.id === popupPlaceholder.id), false,
    "opening the popup also cleans a placeholder after a missed move event");
  const navigated = await message({ type: "addTask", name: "Navigate Placeholder", windowId: 7 });
  assert.equal(navigated.ok, true);
  const navigatedTab = tabs.find((tab) => tab.groupId === navigated.summary.groupId);
  navigatedTab.url = "https://example.test/work";
  onUpdatedListener(navigatedTab.id, { url: navigatedTab.url }, navigatedTab);
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(tabs.some((tab) => tab.id === navigatedTab.id), true,
    "navigating the placeholder itself keeps that tab open");
  const removable = await message({ type: "addTask", name: "Remove Placeholder", windowId: 7 });
  const removableTab = tabs.find((tab) => tab.groupId === removable.summary.groupId);
  assert.equal((await message({ type: "removeTask", taskId: removable.summary.task.id })).ok, true);
  assert.equal(tabs.some((tab) => tab.id === removableTab.id), false, "removing a task closes its unused placeholder");
  const automatic = await message({ type: "addTask", name: "Auto Project", windowId: 7 });
  const automaticPlaceholder = tabs.find((tab) => tab.groupId === automatic.summary.groupId);
  const automaticPage = { id: 65, windowId: 7, title: "Auto Project Page", url: "https://auto.test/page", status: "complete", groupId: -1 };
  tabs.push(automaticPage);
  sessionApiKey = "test-key";
  assert.equal((await message({ type: "organizeOneTask", taskId: automatic.summary.task.id })).ok, true);
  assert.equal(automaticPage.groupId, automatic.summary.groupId, "task Sort reuses the empty task group");
  assert.equal(tabs.some((tab) => tab.id === automaticPlaceholder.id), false,
    "task Sort also closes the placeholder when it adds the first real page");
  const resettable = await message({ type: "addTask", name: "Reset Placeholder", windowId: 7 });
  const resettableTab = tabs.find((tab) => tab.groupId === resettable.summary.groupId);
  assert.equal((await message({ type: "restoreTabs" })).ok, true);
  assert.equal(tabs.some((tab) => tab.id === resettableTab.id), false, "Reset closes unused task placeholders");
  console.log("PASS: site navigation, group identity, manual placement, import, export, and reset");
})().catch((error) => { console.error(error); process.exitCode = 1; });
