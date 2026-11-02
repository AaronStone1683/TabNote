importScripts("activity-log.js");
importScripts("decision-store.js");
importScripts("typesafe.js");
importScripts("task-transfer.js");

const SITE_PREFIX = "🌐 ";
const TASK_PREFIX = "📌 ";
const NO_GROUP = -1;
const DEBOUNCE_MS = 600;
const timers = new Map();
const running = new Map();
const logOperations = new Map();
const pluginGroupChanges = new Map();
const manualWrites = new Map();
const importingWindows = new Set();
let snapshotSeed = Promise.resolve();

function queueManualWrite(tabId, operation) {
  const previous = manualWrites.get(tabId) || Promise.resolve();
  const current = previous.catch(() => {}).then(operation);
  manualWrites.set(tabId, current);
  current.finally(() => {
    if (manualWrites.get(tabId) === current) manualWrites.delete(tabId);
  }).catch((error) => console.warn("Manual tab placement could not be saved:", error));
}

function expectPluginGroupChange(tabIds, expectedGroupId) {
  const tickets = [];
  for (const tabId of [tabIds].flat()) {
    const ticket = { expectedGroupId };
    const queue = pluginGroupChanges.get(tabId) || [];
    queue.push(ticket);
    pluginGroupChanges.set(tabId, queue);
    tickets.push([tabId, ticket]);
    const timeout = setTimeout(() => removeTicket(tabId, ticket), 2_000);
    timeout.unref?.();
  }
  return () => tickets.forEach(([tabId, ticket]) => removeTicket(tabId, ticket));
}

function removeTicket(tabId, ticket) {
  const queue = pluginGroupChanges.get(tabId);
  if (!queue) return;
  const index = queue.indexOf(ticket);
  if (index >= 0) queue.splice(index, 1);
  if (!queue.length) pluginGroupChanges.delete(tabId);
}

function consumePluginGroupChange(tabId, groupId) {
  const queue = pluginGroupChanges.get(tabId);
  if (!queue) return false;
  const ticket = queue.find((item) => item.expectedGroupId === groupId ||
    (item.expectedGroupId === null && groupId >= 0));
  if (!ticket) return false;
  removeTicket(tabId, ticket);
  return true;
}

async function groupTabs(options) {
  const cancel = expectPluginGroupChange(options.tabIds, options.groupId ?? null);
  try {
    return await chrome.tabs.group(options);
  } catch (error) {
    cancel();
    throw error;
  }
}

async function ungroupTabs(tabIds) {
  const cancel = expectPluginGroupChange(tabIds, NO_GROUP);
  try {
    return await chrome.tabs.ungroup(tabIds);
  } catch (error) {
    cancel();
    throw error;
  }
}

function queueLog(tabId, operation) {
  const previous = logOperations.get(tabId) || Promise.resolve();
  const current = previous.catch(() => {}).then(() => snapshotSeed).then(operation);
  logOperations.set(tabId, current);
  current.finally(() => {
    if (logOperations.get(tabId) === current) logOperations.delete(tabId);
  }).catch((error) => console.warn("Tab activity logging failed:", error));
}

function seedCurrentTabs() {
  snapshotSeed = chrome.tabs.query({}).then((tabs) => TabnoteActivityLog.seedSnapshots(tabs));
  snapshotSeed.catch((error) => console.warn("Tab snapshot setup failed:", error));
  return snapshotSeed;
}

async function protectExistingTaskGroups() {
  const { manualPlacementsMigrated } = await chrome.storage.local.get({ manualPlacementsMigrated: false });
  if (manualPlacementsMigrated) return;
  const groups = await chrome.tabGroups.query({});
  const taskGroupIds = new Set(groups.filter((group) => group.title?.startsWith(TASK_PREFIX)).map((group) => group.id));
  const tabs = (await chrome.tabs.query({})).filter((tab) => taskGroupIds.has(tab.groupId));
  const alreadyManual = await TabnoteDecisionStore.getManual(tabs.map((tab) => tab.id));
  for (const tab of tabs) {
    if (!alreadyManual.has(tab.id)) {
      await TabnoteDecisionStore.setManual(tab.id, tab.groupId, tab.windowId, tab.title || "", tab.url || "");
    }
  }
  await chrome.storage.local.set({ manualPlacementsMigrated: true });
}

async function backfillTaskAssignments() {
  const { taskAssignmentsMigrated } = await chrome.storage.local.get({ taskAssignmentsMigrated: false });
  if (taskAssignmentsMigrated) return;
  await Promise.all(manualWrites.values());
  const [records, tabs, groups, current] = await Promise.all([
    TabnoteDecisionStore.getAllManual(), chrome.tabs.query({}), chrome.tabGroups.query({}), settings()
  ]);
  const tabById = new Map(tabs.map((tab) => [tab.id, tab]));
  const groupById = new Map(groups.map((group) => [group.id, group]));
  const existing = await TabnoteDecisionStore.getAssignments(records.map((record) => record.url));
  for (const record of records) {
    const tab = tabById.get(record.tabId);
    if (!tab || tab.groupId !== record.groupId || !siteOf(tab) || existing.has(tab.url)) continue;
    const groupTitle = groupById.get(tab.groupId)?.title;
    const task = current.tasks.find((item) => groupTitle === TASK_PREFIX + item.name);
    if (task) {
      await TabnoteDecisionStore.setAssignment(tab.url, task.id);
      existing.set(tab.url, task.id);
    }
  }
  await chrome.storage.local.set({ taskAssignmentsMigrated: true });
}

async function reconcileManualTabs() {
  const records = await TabnoteDecisionStore.getAllManual();
  if (!records.length) return;
  const tabs = await chrome.tabs.query({});
  const currentById = new Map(tabs.map((tab) => [tab.id, tab]));
  const used = new Set();
  for (const record of records) {
    const current = currentById.get(record.tabId);
    if (current) {
      used.add(current.id);
      continue;
    }
    // Restored Chrome tabs may receive new IDs. Match the old page to its new tab.
    const matches = tabs.filter((tab) => !used.has(tab.id) &&
      (record.groupId === NO_GROUP ? tab.groupId === NO_GROUP : tab.groupId !== NO_GROUP) &&
      ((record.url && tab.url === record.url) || (!record.url && record.title && tab.title === record.title)));
    for (const tab of matches) {
      await TabnoteDecisionStore.setManual(tab.id, tab.groupId, tab.windowId, tab.title || "", tab.url || "");
      used.add(tab.id);
    }
    await TabnoteDecisionStore.deleteManual(record.tabId);
  }
}

function siteOf(tab) {
  if (tab.pinned || !tab.url) return null;
  try {
    const url = new URL(tab.url);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}

function isOwnedGroup(group) {
  return group.title?.startsWith(SITE_PREFIX) || group.title?.startsWith(TASK_PREFIX);
}

async function recordManualPlacement(tab, groupId) {
  await TabnoteDecisionStore.setManual(tab.id, groupId, tab.windowId, tab.title || "", tab.url || "");
  if (!siteOf(tab)) return;
  const groups = groupId === NO_GROUP ? [] : await chrome.tabGroups.query({ windowId: tab.windowId });
  const title = groups.find((group) => group.id === groupId)?.title;
  const { tasks } = await settings();
  const task = tasks.find((item) => title === TASK_PREFIX + item.name);
  if (task) await TabnoteDecisionStore.setAssignment(tab.url, task.id);
  else await TabnoteDecisionStore.deleteAssignment(tab.url);
}

async function targetTitle(tab, mode, tasks, apiKey) {
  if (mode === "task") {
    if (!siteOf(tab)) return null;
    if (tab.status !== "complete" || !tab.title) return undefined;
    const taskId = await TabnoteTypeSafe.classify(tab.title, tasks, apiKey);
    const task = tasks.find((item) => item.id === taskId);
    return task ? TASK_PREFIX + task.name : null;
  }
  const site = siteOf(tab);
  return site ? SITE_PREFIX + site : null;
}

async function settings() {
  return chrome.storage.local.get({ enabled: true, mode: "site", tasks: [] });
}

async function organizeWindow(windowId, options = {}) {
  if (importingWindows.has(windowId)) return { checked: 0, matched: 0 };
  const current = await settings();
  const summary = { checked: 0, matched: 0 };
  if (!options.force && !current.enabled) return summary;
  const mode = options.mode || current.mode;
  const allTasks = current.tasks;
  const tasks = options.taskId ? allTasks.filter((task) => task.id === options.taskId) : allTasks;
  if (options.taskId && !tasks.length) throw new Error("Task no longer exists.");
  const apiKey = mode === "task" ? (await chrome.storage.session.get("typesafeApiKey")).typesafeApiKey : null;
  if (mode === "task" && !apiKey && !options.force) return summary;
  const tabs = await chrome.tabs.query({ windowId });
  await Promise.all(tabs.map((tab) => manualWrites.get(tab.id)).filter(Boolean));
  const [manual, assignments] = await Promise.all([
    TabnoteDecisionStore.getManual(tabs.map((tab) => tab.id)),
    mode === "task" ? TabnoteDecisionStore.getAssignments(tabs.map((tab) => tab.url)) : Promise.resolve(new Map())
  ]);
  const targets = new Map();
  let nextIndex = 0;
  async function classifyNext() {
    while (nextIndex < tabs.length) {
      const tab = tabs[nextIndex++];
      if (tab.groupId !== NO_GROUP || manual.has(tab.id)) continue;
      if (mode === "task" && siteOf(tab)) {
        const assignedTask = allTasks.find((item) => item.id === assignments.get(tab.url));
        if (assignedTask) {
          if (!options.taskId || assignedTask.id === options.taskId) {
            targets.set(tab.id, TASK_PREFIX + assignedTask.name);
            summary.checked++;
            summary.matched++;
          }
          continue;
        }
      }
      if (mode === "task" && siteOf(tab) && tab.status === "complete" && tab.title) summary.checked++;
      const title = await targetTitle(tab, mode, tasks, apiKey);
      targets.set(tab.id, title);
      if (mode === "task" && title?.startsWith(TASK_PREFIX)) summary.matched++;
    }
  }
  await Promise.all(Array.from({ length: Math.min(3, tabs.length) }, () => classifyNext()));
  if (mode === "task") {
    const latest = await settings();
    if (JSON.stringify(latest.tasks) !== JSON.stringify(allTasks)) {
      schedule(windowId);
      return { checked: 0, matched: 0 };
    }
  }

  await Promise.all([...targets.keys()].map((tabId) => manualWrites.get(tabId)).filter(Boolean));
  const [liveTabs, liveGroups, latestManual] = await Promise.all([
    chrome.tabs.query({ windowId }),
    chrome.tabGroups.query({ windowId }),
    TabnoteDecisionStore.getManual([...targets.keys()])
  ]);
  if (importingWindows.has(windowId)) return { checked: 0, matched: 0 };
  const available = new Map();
  const existing = new Map(liveGroups.filter(isOwnedGroup).map((group) => [group.title, group.id]));
  for (const tab of liveTabs) {
    const title = targets.get(tab.id);
    if (!title || tab.groupId !== NO_GROUP || latestManual.has(tab.id)) continue;
    if (!available.has(title)) available.set(title, []);
    available.get(title).push(tab.id);
  }

  for (const [title, tabIds] of available) {
    const groupId = existing.get(title);
    if (groupId !== undefined) {
      await groupTabs({ groupId, tabIds });
    } else if (title.startsWith(TASK_PREFIX) || tabIds.length >= 2) {
      const newGroupId = await groupTabs({ tabIds });
      await chrome.tabGroups.update(newGroupId, {
        title,
        color: title.startsWith(TASK_PREFIX) ? "purple" : "blue"
      });
    }
  }

  return summary;
}

function runWindow(windowId, options = {}) {
  const previous = running.get(windowId) || Promise.resolve();
  const current = previous.catch(() => {}).then(() => organizeWindow(windowId, options));
  running.set(windowId, current);
  current.finally(() => {
    if (running.get(windowId) === current) running.delete(windowId);
  }).catch(() => {});
  return current;
}

function schedule(windowId) {
  if (windowId < 0) return;
  clearTimeout(timers.get(windowId));
  timers.set(windowId, setTimeout(() => {
    timers.delete(windowId);
    runWindow(windowId).catch((error) => console.warn("Tab organization failed:", error));
  }, DEBOUNCE_MS));
}

async function windowIds() {
  const tabs = await chrome.tabs.query({ windowType: "normal" });
  return [...new Set(tabs.map((tab) => tab.windowId))];
}

async function organizeAllWindows(options = {}) {
  const results = await Promise.all((await windowIds()).map((windowId) => runWindow(windowId, options)));
  return results.reduce((total, result) => ({
    checked: total.checked + result.checked,
    matched: total.matched + result.matched
  }), { checked: 0, matched: 0 });
}

async function restoreAllTabs() {
  // Pause automatic organization so the restored layout stays in place.
  await chrome.storage.local.set({ enabled: false });
  await Promise.all(manualWrites.values());
  await backfillTaskAssignments();
  for (const windowId of await windowIds()) {
    await (running.get(windowId) || Promise.resolve()).catch(() => {});
    const groups = await chrome.tabGroups.query({ windowId });
    const ownedIds = new Set(groups.filter(isOwnedGroup).map((group) => group.id));
    const tabs = await chrome.tabs.query({ windowId });
    const tabIds = tabs.filter((tab) => ownedIds.has(tab.groupId)).map((tab) => tab.id);
    if (tabIds.length) await ungroupTabs(tabIds);
  }
  await TabnoteDecisionStore.clearManual();
}

async function removeTaskAndGroup(taskId) {
  await Promise.all(manualWrites.values());
  const { tasks } = await chrome.storage.local.get({ tasks: [] });
  const task = tasks.find((item) => item.id === taskId);
  if (!task) throw new Error("Task not found. Reopen the popup and try again.");

  const ids = await windowIds();
  for (const windowId of ids) {
    clearTimeout(timers.get(windowId));
    timers.delete(windowId);
    await (running.get(windowId) || Promise.resolve()).catch(() => {});
    const groups = await chrome.tabGroups.query({ windowId });
    const groupIds = new Set(groups.filter((group) => group.title === TASK_PREFIX + task.name).map((group) => group.id));
    if (!groupIds.size) continue;
    const tabs = await chrome.tabs.query({ windowId });
    const tabIds = tabs.filter((tab) => groupIds.has(tab.groupId)).map((tab) => tab.id);
    const manual = await TabnoteDecisionStore.getManual(tabIds);
    const automaticIds = tabIds.filter((tabId) => !manual.has(tabId));
    if (automaticIds.length) await ungroupTabs(automaticIds);
  }

  await chrome.storage.local.set({ tasks: tasks.filter((item) => item.id !== taskId) });
  await TabnoteDecisionStore.deleteTask(taskId);
  await TabnoteDecisionStore.deleteAssignmentsForTask(taskId);
}

async function renameTask(taskId, name) {
  const cleanName = String(name || "").trim().replace(/\s+/g, " ");
  if (!cleanName) throw new Error("Enter a task name.");
  const { tasks } = await chrome.storage.local.get({ tasks: [] });
  const task = tasks.find((item) => item.id === taskId);
  if (!task) throw new Error("Task not found. Reopen the popup and try again.");
  if (tasks.some((item) => item.id !== taskId && item.name.toLowerCase() === cleanName.toLowerCase())) {
    throw new Error("That task already exists.");
  }
  if (task.name === cleanName) return tasks;
  for (const windowId of await windowIds()) {
    clearTimeout(timers.get(windowId));
    timers.delete(windowId);
    await (running.get(windowId) || Promise.resolve()).catch(() => {});
    const groups = await chrome.tabGroups.query({ windowId });
    for (const group of groups.filter((item) => item.title === TASK_PREFIX + task.name)) {
      await chrome.tabGroups.update(group.id, { title: TASK_PREFIX + cleanName });
    }
  }
  const updated = tasks.map((item) => item.id === taskId ? { ...item, name: cleanName } : item);
  await chrome.storage.local.set({ tasks: updated });
  await TabnoteDecisionStore.deleteTask(taskId);
  return updated;
}

async function exportTaskGroup(taskId) {
  const { tasks } = await settings();
  const task = tasks.find((item) => item.id === taskId);
  if (!task) throw new Error("Task not found. Reopen the popup and try again.");
  const groups = await chrome.tabGroups.query({});
  const groupIds = new Set(groups.filter((group) => group.title === TASK_PREFIX + task.name).map((group) => group.id));
  if (!groupIds.size) throw new Error("This task has no open tab group to export.");
  const tabs = (await chrome.tabs.query({})).filter((tab) => groupIds.has(tab.groupId) && siteOf(tab))
    .map((tab) => ({ title: tab.title || "", url: tab.url }));
  if (!tabs.length) throw new Error("This task group has no shareable web tabs.");
  return TabnoteTaskTransfer.validate({ task: task.name, tabs });
}

async function importTaskGroup(payload, windowId) {
  const imported = TabnoteTaskTransfer.validate(payload);
  if (!Number.isInteger(windowId) || windowId < 0) throw new Error("Open a normal browser window before importing.");
  if (importingWindows.has(windowId)) throw new Error("A task group is already being imported in this window.");
  importingWindows.add(windowId);
  clearTimeout(timers.get(windowId));
  timers.delete(windowId);
  const createdIds = [];
  try {
    await (running.get(windowId) || Promise.resolve()).catch(() => {});
    const current = await settings();
    let task = current.tasks.find((item) => item.name.toLowerCase() === imported.task.toLowerCase());
    if (!task) {
      task = { id: `${Date.now()}-${Math.random().toString(36).slice(2)}`, name: imported.task };
      await chrome.storage.local.set({ tasks: [...current.tasks, task] });
    }
    const existing = (await chrome.tabGroups.query({ windowId }))
      .find((group) => group.title === TASK_PREFIX + task.name);
    for (const item of imported.tabs) {
      const tab = await chrome.tabs.create({ windowId, url: item.url, active: false });
      createdIds.push(tab.id);
    }
    const groupId = await groupTabs(existing
      ? { groupId: existing.id, tabIds: createdIds }
      : { tabIds: createdIds });
    await chrome.tabGroups.update(groupId, { title: TASK_PREFIX + task.name, color: "purple", collapsed: false });
    for (let i = 0; i < createdIds.length; i++) {
      const tab = await chrome.tabs.get(createdIds[i]);
      await TabnoteDecisionStore.setManual(tab.id, groupId, windowId, tab.title || imported.tabs[i].title, tab.url || imported.tabs[i].url);
      await TabnoteDecisionStore.setAssignment(imported.tabs[i].url, task.id);
    }
    await chrome.tabs.update(createdIds[0], { active: true });
    return { task: task.name, count: createdIds.length };
  } finally {
    importingWindows.delete(windowId);
  }
}

chrome.tabs.onCreated.addListener((tab) => {
  const timestamp = new Date().toISOString();
  queueLog(tab.id, () => TabnoteActivityLog.recordAdded(tab, timestamp));
  schedule(tab.windowId);
});
chrome.tabs.onUpdated.addListener((_tabId, change, tab) => {
  queueLog(tab.id, () => TabnoteActivityLog.updateSnapshot(tab));
  if (Object.hasOwn(change, "groupId") && !consumePluginGroupChange(tab.id, change.groupId)) {
    queueManualWrite(tab.id, () => recordManualPlacement(tab, change.groupId));
  }
  if (change.url || change.status === "complete") schedule(tab.windowId);
});
chrome.tabs.onRemoved.addListener((tabId, info) => {
  const timestamp = new Date().toISOString();
  queueLog(tabId, () => TabnoteActivityLog.recordClosed(tabId, info, timestamp));
  pluginGroupChanges.delete(tabId);
  queueManualWrite(tabId, () => TabnoteDecisionStore.deleteManual(tabId));
  if (!info.isWindowClosing) {
    settings().then((current) => {
      if (current.mode !== "task") schedule(info.windowId);
    }).catch((error) => console.warn("Tab organization failed:", error));
  }
});
chrome.runtime.onInstalled.addListener(() => {
  seedCurrentTabs().then(() => reconcileManualTabs()).then(() => backfillTaskAssignments())
    .then(() => protectExistingTaskGroups()).then(() => organizeAllWindows())
    .catch((error) => console.warn("Initial setup failed:", error));
});
chrome.runtime.onStartup.addListener(() => {
  seedCurrentTabs().then(() => reconcileManualTabs()).then(() => backfillTaskAssignments()).then(() => organizeAllWindows())
    .catch((error) => console.warn("Startup setup failed:", error));
});
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  let action;
  if (message?.type === "organizeSite") {
    action = chrome.storage.local.set({ mode: "site", enabled: true }).then(() => organizeAllWindows({ force: true, mode: "site" }));
  } else if (message?.type === "organizeTask") {
    action = organizeAllWindows({ force: true, mode: "task" }).then(async (summary) => {
      await chrome.storage.local.set({ mode: "task", enabled: true });
      return summary;
    });
  } else if (message?.type === "organizeOneTask") {
    action = organizeAllWindows({ force: true, mode: "task", taskId: message.taskId });
  } else if (message?.type === "restoreTabs") {
    action = restoreAllTabs();
  } else if (message?.type === "removeTask") {
    action = removeTaskAndGroup(message.taskId);
  } else if (message?.type === "renameTask") {
    action = renameTask(message.taskId, message.name);
  } else if (message?.type === "exportTaskGroup") {
    action = exportTaskGroup(message.taskId);
  } else if (message?.type === "importTaskGroup") {
    action = importTaskGroup(message.payload, message.windowId);
  } else {
    return;
  }
  action.then((summary) => sendResponse({ ok: true, summary })).catch((error) => sendResponse({ ok: false, error: String(error) }));
  return true;
});
