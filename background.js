importScripts("activity-log.js");
importScripts("decision-store.js");
importScripts("typesafe.js");
importScripts("task-transfer.js");

const ICON_SIZES = [16, 32, 48, 64, 128];
let iconThemeSetup;

async function setToolbarIcon(darkBackground) {
  const path = Object.fromEntries(ICON_SIZES.map((size) => [size,
    `icons/icon${darkBackground ? "" : "-dark"}${size}.png`]));
  await chrome.action.setIcon({ path });
}

async function ensureIconTheme() {
  if (iconThemeSetup) return iconThemeSetup;
  iconThemeSetup = (async () => {
    const url = chrome.runtime.getURL("theme.html");
    const exists = chrome.runtime.getContexts
      ? (await chrome.runtime.getContexts({
        contextTypes: ["OFFSCREEN_DOCUMENT"], documentUrls: [url]
      })).length > 0
      : (await clients.matchAll({ includeUncontrolled: true })).some((client) => client.url === url);
    if (!exists) {
      await chrome.offscreen.createDocument({
        url: "theme.html",
        reasons: ["MATCH_MEDIA"],
        justification: "Keep the toolbar icon legible when the color scheme changes."
      });
    }
    const scheme = await chrome.runtime.sendMessage({ type: "tabnote:getColorScheme" });
    await setToolbarIcon(Boolean(scheme?.dark));
  })().finally(() => { iconThemeSetup = undefined; });
  return iconThemeSetup;
}

const LEGACY_SITE_PREFIX = "🌐 ";
const SITE_PREFIX = "\u2063";
const TASK_PREFIX = "📌 ";
const SITE_COLORS = ["red", "yellow", "green", "pink", "cyan", "orange", "blue", "grey"];
const ownedGroups = new Map();
let ownedGroupsReady;
let registryWrite = Promise.resolve();
const NO_GROUP = -1;
const DEBOUNCE_MS = 600;
const timers = new Map();
let groupSyncTimer;
const running = new Map();
const logOperations = new Map();
const pluginGroupChanges = new Map();
const recentPluginMoves = new Map();
const manualWrites = new Map();
const navigationChecks = new Map();
const placeholderChecks = new Map();
let placeholderScanTimer;
const placeholderMovedTabs = new Set();
const importingWindows = new Set();
let snapshotSeed = Promise.resolve();
let taskCreation = Promise.resolve();

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
  for (const tabId of [options.tabIds].flat()) recentPluginMoves.set(tabId, Date.now());
  const cancel = expectPluginGroupChange(options.tabIds, options.groupId ?? null);
  try {
    return await chrome.tabs.group(options);
  } catch (error) {
    cancel();
    throw error;
  }
}

async function ungroupTabs(tabIds) {
  for (const tabId of [tabIds].flat()) recentPluginMoves.set(tabId, Date.now());
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
  await ensureOwnedGroups();
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
    const group = groupById.get(tab.groupId);
    const groupRecord = group && ownedGroups.get(group.id);
    const task = current.tasks.find((item) => groupRecord?.kind === "task" && groupRecord.key === item.id);
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

async function reconcileSiteNavigation(tabId) {
  await ensureOwnedGroups();
  await manualWrites.get(tabId);
  let tab;
  try {
    tab = await chrome.tabs.get(tabId);
  } catch {
    return; // The tab closed while its navigation was being checked.
  }
  const record = ownedGroups.get(tab.groupId);
  if (record?.kind !== "site" || siteOf(tab) === record.key) return;
  const manual = await TabnoteDecisionStore.getManual([tabId]);
  if (manual.has(tabId)) return;
  // Re-read after IndexedDB: a manual move or another navigation may have happened.
  const latest = await chrome.tabs.get(tabId).catch(() => null);
  if (!latest || latest.groupId !== tab.groupId || siteOf(latest) === record.key) return;
  await ungroupTabs([tabId]);
  schedule(latest.windowId);
}

function queueSiteNavigation(tabId) {
  const previous = navigationChecks.get(tabId) || Promise.resolve();
  const current = previous.catch(() => {}).then(() => reconcileSiteNavigation(tabId));
  navigationChecks.set(tabId, current);
  current.finally(() => {
    if (navigationChecks.get(tabId) === current) navigationChecks.delete(tabId);
  }).catch((error) => console.warn("Site group navigation check failed:", error));
}

function siteLabel(hostname) {
  if (/^(?:\d{1,3}\.){3}\d{1,3}$/.test(hostname)) return hostname;
  const parts = hostname.split(".");
  const first = /^www\d*$/i.test(parts[0]) && parts.length > 2 ? 1 : 0;
  return parts[first] || hostname;
}

function oldSiteLabel(hostname) {
  const parts = hostname.split(".");
  return parts.length > 1 ? parts.at(-2) : hostname;
}

function isBlankTab(tab) {
  const url = tab.pendingUrl || tab.url;
  return !url || ["about:blank", "chrome://newtab/", "chrome://new-tab-page/"].includes(url);
}

function groupTabsById(tabs) {
  const result = new Map();
  for (const tab of tabs) {
    if (!result.has(tab.groupId)) result.set(tab.groupId, []);
    result.get(tab.groupId).push(tab);
  }
  return result;
}

function urlFingerprint(url) {
  let hash = 2166136261;
  for (let i = 0; i < url.length; i++) hash = Math.imul(hash ^ url.charCodeAt(i), 16777619);
  return (hash >>> 0).toString(16);
}

function groupUrlHashes(tabs) {
  return [...new Set(tabs.map((tab) => tab.url && urlFingerprint(tab.url)).filter(Boolean))];
}

function saveOwnedGroups() {
  const records = [...ownedGroups.values()].map((record) => ({ ...record, urlHashes: [...record.urlHashes] }));
  registryWrite = registryWrite.catch(() => {}).then(() => chrome.storage.local.set({ ownedGroupsV1: records }));
  return registryWrite;
}

async function loadOwnedGroups() {
  const [saved, groups, tabs, current] = await Promise.all([
    chrome.storage.local.get({ ownedGroupsV1: [] }), chrome.tabGroups.query({}), chrome.tabs.query({}), settings()
  ]);
  const members = groupTabsById(tabs);
  const unmatched = new Set(groups.map((group) => group.id));
  const records = Array.isArray(saved.ownedGroupsV1) ? saved.ownedGroupsV1 : [];
  for (const record of records) {
    if (!record || !["site", "task", "detached"].includes(record.kind) || typeof record.key !== "string" ||
        !Array.isArray(record.urlHashes)) continue;
    const candidates = groups.filter((group) => unmatched.has(group.id));
    const match = candidates.find((group) => group.id === record.id &&
      (group.title === record.title || (members.get(group.id) || []).some((tab) =>
        (tab.url && record.urlHashes.includes(urlFingerprint(tab.url))) ||
        (record.placeholderTabId && tab.id === record.placeholderTabId)))) ||
      candidates.find((group) => group.title === record.title &&
        (members.get(group.id) || []).some((tab) =>
          tab.url && record.urlHashes.includes(urlFingerprint(tab.url))));
    if (!match) continue;
    if (record.kind === "site" && (match.title === record.key ||
        match.title?.startsWith(SITE_PREFIX) || match.title?.startsWith(LEGACY_SITE_PREFIX) ||
        (match.title === oldSiteLabel(record.key) && match.title === record.title))) {
      const title = siteLabel(record.key);
      if (match.title !== title) await chrome.tabGroups.update(match.id, { title });
      match.title = title;
    }
    const groupMembers = members.get(match.id) || [];
    const placeholder = record.kind === "task" && Number.isInteger(record.placeholderTabId) &&
      (groupMembers.find((tab) => tab.id === record.placeholderTabId) ||
        (groupMembers.filter((tab) => tab.url === "about:blank").length === 1
          ? groupMembers.find((tab) => tab.url === "about:blank") : null));
    ownedGroups.set(match.id, { id: match.id, kind: record.kind, key: record.key,
      title: match.title || "", urlHashes: groupUrlHashes(groupMembers),
      ...(placeholder ? { placeholderTabId: placeholder.id } : {}) });
    unmatched.delete(match.id);
  }
  for (const group of groups.filter((item) => unmatched.has(item.id))) {
    let kind, key;
    if (group.title?.startsWith(SITE_PREFIX)) {
      kind = "site";
      key = group.title.slice(SITE_PREFIX.length);
    } else if (group.title?.startsWith(LEGACY_SITE_PREFIX)) {
      kind = "site";
      key = group.title.slice(LEGACY_SITE_PREFIX.length);
    } else {
      const task = current.tasks.find((item) => group.title === TASK_PREFIX + item.name);
      if (task) { kind = "task"; key = task.id; }
    }
    if (!key) continue;
    const title = kind === "site" ? siteLabel(key) : group.title;
    if (group.title !== title) await chrome.tabGroups.update(group.id, { title });
    ownedGroups.set(group.id, { id: group.id, kind, key, title, urlHashes: groupUrlHashes(members.get(group.id) || []) });
  }
  await saveOwnedGroups();
}

function ensureOwnedGroups() {
  if (!ownedGroupsReady) ownedGroupsReady = loadOwnedGroups().catch((error) => {
    ownedGroupsReady = null;
    throw error;
  });
  return ownedGroupsReady;
}

async function claimGroup(id, kind, key) {
  await ensureOwnedGroups();
  const [group, tabs] = await Promise.all([chrome.tabGroups.get(id), chrome.tabs.query({ groupId: id })]);
  const previous = ownedGroups.get(id);
  ownedGroups.set(id, { id, kind, key, title: group.title || "", urlHashes: groupUrlHashes(tabs),
    ...(previous?.kind === kind && previous.key === key && previous.placeholderTabId
      ? { placeholderTabId: previous.placeholderTabId } : {}) });
  await saveOwnedGroups();
}

async function closeTaskPlaceholder(groupId) {
  await ensureOwnedGroups();
  const record = ownedGroups.get(groupId);
  if (record?.kind !== "task" || !record.placeholderTabId) return;
  const tabId = record.placeholderTabId;
  const tab = await chrome.tabs.get(tabId).catch(() => null);
  if (tab?.groupId === groupId && isBlankTab(tab)) await chrome.tabs.remove(tabId);
  if (ownedGroups.get(groupId)?.placeholderTabId === tabId) {
    delete ownedGroups.get(groupId).placeholderTabId;
    await saveOwnedGroups();
  }
}

async function reconcileTaskPlaceholder(groupId) {
  await ensureOwnedGroups();
  const record = ownedGroups.get(groupId);
  if (record?.kind !== "task" || !record.placeholderTabId) return;
  const tabs = await chrome.tabs.query({ groupId });
  const placeholder = tabs.find((tab) => tab.id === record.placeholderTabId);
  if (!placeholder || !isBlankTab(placeholder)) {
    delete record.placeholderTabId;
    await saveOwnedGroups();
  } else if (tabs.some((tab) => tab.id !== placeholder.id && !isBlankTab(tab))) {
    await closeTaskPlaceholder(groupId);
  }
}

function queueTaskPlaceholderCheck(groupId) {
  const previous = placeholderChecks.get(groupId) || Promise.resolve();
  const current = previous.catch(() => {}).then(() => reconcileTaskPlaceholder(groupId));
  placeholderChecks.set(groupId, current);
  current.finally(() => {
    if (placeholderChecks.get(groupId) === current) placeholderChecks.delete(groupId);
  }).catch((error) => console.warn("Task placeholder cleanup failed:", error));
  return current;
}

async function reconcileTaskPlaceholders() {
  await ensureOwnedGroups();
  await Promise.all([...ownedGroups.values()].filter((record) => record.placeholderTabId)
    .map((record) => queueTaskPlaceholderCheck(record.id)));
}

function scheduleTaskPlaceholderScan(tabId) {
  placeholderMovedTabs.add(tabId);
  clearTimeout(placeholderScanTimer);
  placeholderScanTimer = setTimeout(async () => {
    placeholderScanTimer = null;
    const movedTabIds = [...placeholderMovedTabs];
    placeholderMovedTabs.clear();
    try {
      await ensureOwnedGroups();
      for (const id of movedTabIds) {
        const lastPluginMove = recentPluginMoves.get(id);
        if (lastPluginMove && Date.now() - lastPluginMove < 2_000) continue;
        recentPluginMoves.delete(id);
        const tab = await chrome.tabs.get(id).catch(() => null);
        const record = tab && ownedGroups.get(tab.groupId);
        if (record?.kind === "task" && record.placeholderTabId && tab.id !== record.placeholderTabId) {
          await recordManualPlacement(tab, tab.groupId);
        }
      }
      await reconcileTaskPlaceholders();
    } catch (error) {
      console.warn("Task placeholder cleanup failed:", error);
    }
  }, 150);
}

async function createTask(name, windowId) {
  const operation = taskCreation.catch(() => {}).then(async () => {
    await ensureOwnedGroups();
    const cleanName = String(name || "").trim().replace(/\s+/g, " ");
    if (!cleanName || cleanName.length > 52) throw new Error("Task name must be 1–52 characters.");
    if (!Number.isInteger(windowId) || windowId < 0) throw new Error("Open a normal browser window to add a task.");
    const current = await settings();
    if (current.tasks.some((item) => item.name.toLowerCase() === cleanName.toLowerCase())) {
      throw new Error("That task already exists.");
    }
    const task = { id: `${Date.now()}-${Math.random().toString(36).slice(2)}`, name: cleanName };
    await chrome.storage.local.set({ tasks: [...current.tasks, task] });
    let placeholder;
    try {
      placeholder = await chrome.tabs.create({ windowId, url: "about:blank", active: false });
      const groupId = await groupTabs({ tabIds: [placeholder.id] });
      await chrome.tabGroups.update(groupId, { title: TASK_PREFIX + task.name, color: "purple", collapsed: false });
      await claimGroup(groupId, "task", task.id);
      ownedGroups.get(groupId).placeholderTabId = placeholder.id;
      await saveOwnedGroups();
      return { task, groupId };
    } catch (error) {
      if (placeholder) await chrome.tabs.remove(placeholder.id).catch(() => {});
      await chrome.storage.local.set({ tasks: current.tasks });
      throw error;
    }
  });
  taskCreation = operation;
  return operation;
}

async function adoptGroup(group) {
  await ensureOwnedGroups();
  if (ownedGroups.has(group.id)) return syncOwnedGroup(group.id);
  if (group.title?.startsWith(SITE_PREFIX) || group.title?.startsWith(LEGACY_SITE_PREFIX)) {
    const prefix = group.title.startsWith(SITE_PREFIX) ? SITE_PREFIX : LEGACY_SITE_PREFIX;
    const site = group.title.slice(prefix.length);
    if (!site) return;
    await chrome.tabGroups.update(group.id, { title: siteLabel(site) });
    return claimGroup(group.id, "site", site);
  }
  const { tasks } = await settings();
  const task = tasks.find((item) => group.title === TASK_PREFIX + item.name);
  if (task) await claimGroup(group.id, "task", task.id);
}

async function forgetGroup(id) {
  await ensureOwnedGroups();
  if (ownedGroups.delete(id)) await saveOwnedGroups();
}

async function syncOwnedGroup(id) {
  await ensureOwnedGroups();
  const record = ownedGroups.get(id);
  if (!record) return;
  let group;
  try {
    group = await chrome.tabGroups.get(id);
  } catch {
    await forgetGroup(id);
    return;
  }
  if (!group) {
    await forgetGroup(id);
    return;
  }
  const tabs = await chrome.tabs.query({ groupId: id });
  const title = group.title || "";
  const urlHashes = groupUrlHashes(tabs);
  if (record.title === title && JSON.stringify(record.urlHashes) === JSON.stringify(urlHashes)) return;
  record.title = title;
  record.urlHashes = urlHashes;
  await saveOwnedGroups();
}

function scheduleGroupSync() {
  clearTimeout(groupSyncTimer);
  groupSyncTimer = setTimeout(() => {
    Promise.all([...ownedGroups.keys()].map(syncOwnedGroup)).catch((error) =>
      console.warn("Group metadata could not be saved:", error));
  }, 500);
}

function isOwnedGroup(group) {
  return ownedGroups.has(group.id);
}

function ownedBy(kind, key, groups) {
  return groups.filter((group) => {
    const record = ownedGroups.get(group.id);
    return record?.kind === kind && record.key === key;
  });
}

function randomSiteColor(groups) {
  const counts = new Map(SITE_COLORS.map((color) => [color, 0]));
  for (const group of groups) {
    if (ownedGroups.get(group.id)?.kind === "site" && counts.has(group.color)) {
      counts.set(group.color, counts.get(group.color) + 1);
    }
  }
  const fewest = Math.min(...counts.values());
  const choices = SITE_COLORS.filter((color) => counts.get(color) === fewest);
  return choices[Math.floor(Math.random() * choices.length)];
}

async function listSiteGroups() {
  await ensureOwnedGroups();
  const [groups, tabs] = await Promise.all([chrome.tabGroups.query({}), chrome.tabs.query({})]);
  const byGroup = groupTabsById(tabs);
  return groups.filter((group) => ownedGroups.get(group.id)?.kind === "site").map((group) => {
    const members = byGroup.get(group.id) || [];
    const site = ownedGroups.get(group.id).key;
    const favicon = members.find((tab) => siteOf(tab) === site && tab.favIconUrl)?.favIconUrl || "";
    return { id: group.id, site, label: group.title || site, color: group.color, count: members.length, favicon };
  }).sort((a, b) => a.site.localeCompare(b.site));
}

async function popupGroups() {
  await reconcileTaskPlaceholders();
  const [sites, groups, tabs, current] = await Promise.all([
    listSiteGroups(), chrome.tabGroups.query({}), chrome.tabs.query({}), settings()
  ]);
  const members = groupTabsById(tabs);
  const taskIcons = {};
  for (const group of groups) {
    const record = ownedGroups.get(group.id);
    if (record?.kind !== "task" || Object.hasOwn(taskIcons, record.key)) continue;
    const firstWebTab = (members.get(group.id) || []).find((tab) => siteOf(tab));
    if (firstWebTab) taskIcons[record.key] = firstWebTab.favIconUrl || "";
  }
  return { sites, taskIcons, autoSite: Boolean(current.autoSite) };
}

async function getSiteGroup(id) {
  await ensureOwnedGroups();
  const record = ownedGroups.get(id);
  if (record?.kind !== "site") throw new Error("Site group no longer exists. Reopen the popup and try again.");
  const group = await chrome.tabGroups.get(id);
  return { record, group };
}

async function sortOneSite(id) {
  const { record } = await getSiteGroup(id);
  return organizeAllWindows({ force: true, mode: "site", site: record.key });
}

async function exportSiteGroup(id) {
  const { record, group } = await getSiteGroup(id);
  const tabs = (await chrome.tabs.query({ groupId: id })).filter((tab) => siteOf(tab))
    .map((tab) => ({ title: tab.title || "", url: tab.url }));
  if (!tabs.length) throw new Error("This site group has no shareable web tabs.");
  return TabnoteTaskTransfer.validateSite({ site: record.key, label: group.title || record.key, tabs });
}

async function renameSiteGroup(id, name) {
  const { record } = await getSiteGroup(id);
  const label = String(name || "").trim().replace(/\s+/g, " ");
  if (!label || label.length > 52) throw new Error("Site group name must be 1–52 characters.");
  await chrome.tabGroups.update(id, { title: label });
  await syncOwnedGroup(id);
  return { id, site: record.key, label };
}

async function removeSiteGroup(id) {
  const { group } = await getSiteGroup(id);
  const tabs = await chrome.tabs.query({ groupId: id });
  await Promise.all(tabs.map((tab) => manualWrites.get(tab.id)).filter(Boolean));
  const manual = await TabnoteDecisionStore.getManual(tabs.map((tab) => tab.id));
  const automatic = tabs.filter((tab) => !manual.has(tab.id)).map((tab) => tab.id);
  if (automatic.length) await ungroupTabs(automatic);
  if (manual.size) {
    ownedGroups.get(id).kind = "detached";
    await saveOwnedGroups();
  } else {
    await forgetGroup(id);
  }
  return { removed: automatic.length, preserved: tabs.length - automatic.length, label: group.title };
}

async function recordManualPlacement(tab, groupId) {
  await TabnoteDecisionStore.setManual(tab.id, groupId, tab.windowId, tab.title || "", tab.url || "");
  if (!siteOf(tab)) return;
  await ensureOwnedGroups();
  const record = ownedGroups.get(groupId);
  const { tasks } = await settings();
  const task = tasks.find((item) => record?.kind === "task" && record.key === item.id);
  if (task) await TabnoteDecisionStore.setAssignment(tab.url, task.id);
  else await TabnoteDecisionStore.deleteAssignment(tab.url);
}

async function targetTitle(tab, mode, tasks, apiKey) {
  if (mode === "task") {
    if (!siteOf(tab)) return null;
    if (tab.status !== "complete" || (apiKey && !tab.title)) return undefined;
    const taskId = await TabnoteTypeSafe.classify(tab.title || "", tasks, apiKey, tab.url);
    const task = tasks.find((item) => item.id === taskId);
    return task ? TASK_PREFIX + task.name : null;
  }
  const site = siteOf(tab);
  return site ? SITE_PREFIX + site : null;
}

async function settings() {
  return chrome.storage.local.get({ enabled: false, autoSite: false, mode: "site", tasks: [] });
}

async function organizeWindow(windowId, options = {}) {
  await ensureOwnedGroups();
  if (importingWindows.has(windowId)) return { checked: 0, matched: 0 };
  const current = await settings();
  const summary = { checked: 0, matched: 0 };
  const mode = options.mode || "site";
  if (!options.force && !current.autoSite) return summary;
  const allTasks = current.tasks;
  const tasks = options.taskId ? allTasks.filter((task) => task.id === options.taskId) : allTasks;
  if (options.taskId && !tasks.length) throw new Error("Task no longer exists.");
  const apiKey = mode === "task" ? (await chrome.storage.session.get("typesafeApiKey")).typesafeApiKey : null;
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
      if (mode === "site" && options.site && siteOf(tab) !== options.site) continue;
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
      if (mode === "task" && siteOf(tab) && tab.status === "complete" && (tab.title || !apiKey)) summary.checked++;
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
  const existing = new Map();
  for (const group of liveGroups) {
    const record = ownedGroups.get(group.id);
    if (record?.kind === "site") existing.set(SITE_PREFIX + record.key, group.id);
    if (record?.kind === "task") {
      const task = allTasks.find((item) => item.id === record.key);
      if (task) existing.set(TASK_PREFIX + task.name, group.id);
    }
  }
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
      await syncOwnedGroup(groupId);
      await queueTaskPlaceholderCheck(groupId);
    } else if (title.startsWith(TASK_PREFIX) || tabIds.length >= 2) {
      const newGroupId = await groupTabs({ tabIds });
      const isSite = title.startsWith(SITE_PREFIX);
      const site = isSite ? title.slice(SITE_PREFIX.length) : null;
      const displayedTitle = isSite ? siteLabel(site) : title;
      const color = isSite ? randomSiteColor(liveGroups) : "purple";
      await chrome.tabGroups.update(newGroupId, {
        title: displayedTitle,
        color
      });
      if (isSite) {
        await claimGroup(newGroupId, "site", site);
        liveGroups.push({ id: newGroupId, title: displayedTitle, color });
      } else {
        const task = allTasks.find((item) => title === TASK_PREFIX + item.name);
        if (task) await claimGroup(newGroupId, "task", task.id);
      }
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

function clearScheduledGrouping() {
  for (const timer of timers.values()) clearTimeout(timer);
  timers.clear();
}

async function setAutoSite(enabled) {
  if (!enabled) {
    await chrome.storage.local.set({ autoSite: false });
    return { enabled: false };
  }
  const previous = await settings();
  clearScheduledGrouping();
  await chrome.storage.local.set({ autoSite: false, enabled: false, mode: "site" });
  try {
    const summary = await organizeAllWindows({ force: true, mode: "site" });
    await chrome.storage.local.set({ autoSite: true });
    return summary;
  } catch (error) {
    await chrome.storage.local.set({ autoSite: previous.autoSite, enabled: previous.enabled, mode: previous.mode });
    throw error;
  }
}

async function activateTaskGrouping() {
  const previous = await settings();
  clearScheduledGrouping();
  await chrome.storage.local.set({ autoSite: false, enabled: false, mode: "task" });
  try {
    const summary = await organizeAllWindows({ force: true, mode: "task" });
    await chrome.storage.local.set({ enabled: true });
    return summary;
  } catch (error) {
    await chrome.storage.local.set({ autoSite: previous.autoSite, enabled: previous.enabled, mode: previous.mode });
    throw error;
  }
}

async function restoreAllTabs() {
  await ensureOwnedGroups();
  // Pause automatic organization so the restored layout stays in place.
  await chrome.storage.local.set({ enabled: false, autoSite: false });
  clearScheduledGrouping();
  await Promise.all(manualWrites.values());
  await backfillTaskAssignments();
  for (const windowId of await windowIds()) {
    await (running.get(windowId) || Promise.resolve()).catch(() => {});
    const groups = await chrome.tabGroups.query({ windowId });
    for (const group of groups) await closeTaskPlaceholder(group.id);
    const tabs = await chrome.tabs.query({ windowId });
    const tabIds = tabs.filter((tab) => tab.groupId !== NO_GROUP).map((tab) => tab.id);
    if (tabIds.length) await ungroupTabs(tabIds);
  }
  await TabnoteDecisionStore.clearManual();
  ownedGroups.clear();
  await saveOwnedGroups();
}

async function removeTaskAndGroup(taskId) {
  await ensureOwnedGroups();
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
    const groupIds = new Set(ownedBy("task", taskId, groups).map((group) => group.id));
    if (!groupIds.size) continue;
    for (const groupId of groupIds) await closeTaskPlaceholder(groupId);
    const tabs = await chrome.tabs.query({ windowId });
    const tabIds = tabs.filter((tab) => groupIds.has(tab.groupId)).map((tab) => tab.id);
    if (tabIds.length) await ungroupTabs(tabIds);
    await Promise.all(tabIds.map((tabId) => TabnoteDecisionStore.deleteManual(tabId)));
    for (const groupId of groupIds) await forgetGroup(groupId);
  }

  await chrome.storage.local.set({ tasks: tasks.filter((item) => item.id !== taskId) });
  await TabnoteDecisionStore.deleteTask(taskId);
  await TabnoteDecisionStore.deleteAssignmentsForTask(taskId);
}

async function renameTask(taskId, name) {
  await ensureOwnedGroups();
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
    for (const group of ownedBy("task", taskId, groups)) {
      await chrome.tabGroups.update(group.id, { title: TASK_PREFIX + cleanName });
      await syncOwnedGroup(group.id);
    }
  }
  const updated = tasks.map((item) => item.id === taskId ? { ...item, name: cleanName } : item);
  await chrome.storage.local.set({ tasks: updated });
  await TabnoteDecisionStore.deleteTask(taskId);
  return updated;
}

async function exportTaskGroup(taskId) {
  await ensureOwnedGroups();
  const { tasks } = await settings();
  const task = tasks.find((item) => item.id === taskId);
  if (!task) throw new Error("Task not found. Reopen the popup and try again.");
  const groups = await chrome.tabGroups.query({});
  const groupIds = new Set(ownedBy("task", taskId, groups).map((group) => group.id));
  if (!groupIds.size) throw new Error("This task has no open tab group to export.");
  const tabs = (await chrome.tabs.query({})).filter((tab) => groupIds.has(tab.groupId) && siteOf(tab))
    .map((tab) => ({ title: tab.title || "", url: tab.url }));
  if (!tabs.length) throw new Error("This task group has no shareable web tabs.");
  return TabnoteTaskTransfer.validate({ task: task.name, tabs });
}

async function withImportWindow(windowId, operation) {
  if (!Number.isInteger(windowId) || windowId < 0) throw new Error("Open a normal browser window before importing.");
  if (importingWindows.has(windowId)) throw new Error("A tab set is already being imported in this window.");
  importingWindows.add(windowId);
  clearTimeout(timers.get(windowId));
  timers.delete(windowId);
  try {
    await (running.get(windowId) || Promise.resolve()).catch(() => {});
    return await operation();
  } finally {
    importingWindows.delete(windowId);
  }
}

async function openImportedGroup(items, windowId, { kind, key, title, color, taskId }) {
  const groups = await chrome.tabGroups.query({ windowId });
  const existing = ownedBy(kind, key, groups)[0];
  const createdIds = [];
  for (const item of items) {
    const tab = await chrome.tabs.create({ windowId, url: item.url, active: false });
    createdIds.push(tab.id);
  }
  const groupId = await groupTabs(existing
    ? { groupId: existing.id, tabIds: createdIds }
    : { tabIds: createdIds });
  if (!existing) await chrome.tabGroups.update(groupId, { title, color, collapsed: false });
  await claimGroup(groupId, kind, key);
  if (kind === "task") await queueTaskPlaceholderCheck(groupId);
  for (let i = 0; i < createdIds.length; i++) {
    const tab = await chrome.tabs.get(createdIds[i]);
    await TabnoteDecisionStore.setManual(tab.id, groupId, windowId,
      tab.title || items[i].title, tab.url || items[i].url);
    if (taskId) await TabnoteDecisionStore.setAssignment(items[i].url, taskId);
  }
  await chrome.tabs.update(createdIds[0], { active: true });
  return createdIds.length;
}

async function importTaskGroup(payload, windowId) {
  await ensureOwnedGroups();
  const imported = TabnoteTaskTransfer.validate(payload);
  return withImportWindow(windowId, async () => {
    const current = await settings();
    let task = current.tasks.find((item) => item.name.toLowerCase() === imported.task.toLowerCase());
    if (!task) {
      task = { id: `${Date.now()}-${Math.random().toString(36).slice(2)}`, name: imported.task };
      await chrome.storage.local.set({ tasks: [...current.tasks, task] });
    }
    const count = await openImportedGroup(imported.tabs, windowId,
      { kind: "task", key: task.id, title: TASK_PREFIX + task.name, color: "purple", taskId: task.id });
    return { task: task.name, count };
  });
}

async function importSiteGroup(payload, windowId) {
  await ensureOwnedGroups();
  const imported = TabnoteTaskTransfer.validateSite(payload);
  return withImportWindow(windowId, async () => {
    const groups = await chrome.tabGroups.query({ windowId });
    const count = await openImportedGroup(imported.tabs, windowId,
      { kind: "site", key: imported.site, title: imported.label, color: randomSiteColor(groups) });
    return { site: imported.site, count };
  });
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
  if (change.url) queueSiteNavigation(tab.id);
  if ((change.url || Object.hasOwn(change, "groupId")) && tab.groupId !== NO_GROUP) {
    queueTaskPlaceholderCheck(tab.groupId);
  }
  if ((change.url && tab.groupId !== NO_GROUP) || Object.hasOwn(change, "groupId")) scheduleGroupSync();
});
chrome.tabs.onMoved.addListener(scheduleTaskPlaceholderScan);
chrome.tabs.onAttached.addListener(scheduleTaskPlaceholderScan);
chrome.tabs.onRemoved.addListener((tabId, info) => {
  const timestamp = new Date().toISOString();
  queueLog(tabId, () => TabnoteActivityLog.recordClosed(tabId, info, timestamp));
  pluginGroupChanges.delete(tabId);
  recentPluginMoves.delete(tabId);
  navigationChecks.delete(tabId);
  queueManualWrite(tabId, () => TabnoteDecisionStore.deleteManual(tabId));
  ensureOwnedGroups().then(() => {
    for (const record of ownedGroups.values()) {
      if (record.placeholderTabId === tabId) queueTaskPlaceholderCheck(record.id);
    }
  }).catch((error) => console.warn("Task placeholder cleanup failed:", error));
  scheduleGroupSync();
  if (!info.isWindowClosing) {
    settings().then((current) => {
      if (current.autoSite) schedule(info.windowId);
    }).catch((error) => console.warn("Tab organization failed:", error));
  }
});
chrome.tabGroups.onUpdated.addListener((group) => {
  adoptGroup(group).catch((error) => console.warn("Group update could not be saved:", error));
});
chrome.tabGroups.onCreated.addListener((group) => {
  adoptGroup(group).catch((error) => console.warn("Group creation could not be saved:", error));
});
chrome.tabGroups.onRemoved.addListener((group) => {
  forgetGroup(group.id).catch((error) => console.warn("Group removal could not be saved:", error));
});
chrome.runtime.onInstalled.addListener(() => {
  seedCurrentTabs().then(() => reconcileManualTabs()).then(() => backfillTaskAssignments())
    .then(() => protectExistingTaskGroups()).then(() => reconcileTaskPlaceholders()).then(() => organizeAllWindows())
    .catch((error) => console.warn("Initial setup failed:", error));
});
chrome.runtime.onStartup.addListener(() => {
  seedCurrentTabs().then(() => reconcileManualTabs()).then(() => backfillTaskAssignments())
    .then(() => reconcileTaskPlaceholders()).then(() => organizeAllWindows())
    .catch((error) => console.warn("Startup setup failed:", error));
});
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "tabnote:colorSchemeChanged" && sender.url === chrome.runtime.getURL("theme.html")) {
    setToolbarIcon(Boolean(message.dark)).catch((error) => console.warn("Tabnote icon update failed:", error));
    return;
  }
  let action;
  if (message?.type === "organizeSite") {
    action = organizeAllWindows({ force: true, mode: "site" });
  } else if (message?.type === "addTask") {
    action = createTask(message.name, message.windowId);
  } else if (message?.type === "setAutoSite") {
    action = setAutoSite(Boolean(message.enabled));
  } else if (message?.type === "organizeTask") {
    action = activateTaskGrouping();
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
  } else if (message?.type === "importSiteGroup") {
    action = importSiteGroup(message.payload, message.windowId);
  } else if (message?.type === "listSiteGroups") {
    action = listSiteGroups();
  } else if (message?.type === "popupGroups") {
    action = popupGroups();
  } else if (message?.type === "sortOneSite") {
    action = sortOneSite(message.groupId);
  } else if (message?.type === "exportSiteGroup") {
    action = exportSiteGroup(message.groupId);
  } else if (message?.type === "renameSiteGroup") {
    action = renameSiteGroup(message.groupId, message.name);
  } else if (message?.type === "removeSiteGroup") {
    action = removeSiteGroup(message.groupId);
  } else {
    return;
  }
  action.then((summary) => sendResponse({ ok: true, summary })).catch((error) => sendResponse({ ok: false, error: String(error) }));
  return true;
});

if (chrome.offscreen?.createDocument) {
  ensureIconTheme().catch((error) => console.warn("Tabnote icon theme setup failed:", error));
}
