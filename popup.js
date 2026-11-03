const taskForm = document.getElementById("taskForm");
const taskInput = document.getElementById("taskInput");
const taskList = document.getElementById("taskList");
const siteList = document.getElementById("siteList");
const autoSite = document.getElementById("autoSite");
const siteSwitch = autoSite.closest(".site-switch");
const status = document.getElementById("status");
const resetButton = document.getElementById("restoreTabs");
const exportButton = document.getElementById("exportLog");
const apiKeyToggle = document.getElementById("apiKeyToggle");
const apiKeyForm = document.getElementById("apiKeyForm");
const apiKeyInput = document.getElementById("apiKeyInput");
const importButton = document.getElementById("importTaskGroup");
const importFile = document.getElementById("taskGroupFile");
const addButton = taskForm.querySelector(".add-button");
let tasks = [];
let taskIcons = {};
let refreshSerial = 0;
let refreshTimer;
const ICONS = {
  sort: '<svg viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="M8.4 5.2h2.7l1.5 1.6h4.1c.7 0 1.3.6 1.3 1.3v7.6c0 .7-.6 1.3-1.3 1.3H8.4" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/><path d="M2.3 11.4h9m-3-3 3 3-3 3" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  share: '<svg viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="M10 2.5v9m0 0 3-3m-3 3-3-3M3.5 13.2v3.1c0 .5.4.8.8.8h11.4c.4 0 .8-.3.8-.8v-3.1" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  edit: '<svg viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="m3.2 16.8 3.4-.8 9.1-9.1a1.7 1.7 0 0 0-2.4-2.4l-9.1 9.1-.8 3.2Z" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/><path d="m11.9 5.9 2.4 2.4M2.9 18h5.3" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>',
  remove: '<svg viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="m5 5 10 10M15 5 5 15" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>'
};

function showKeyForm(visible) {
  apiKeyForm.hidden = !visible;
  apiKeyToggle.setAttribute("aria-expanded", String(visible));
  if (visible) apiKeyInput.focus();
}

apiKeyToggle.addEventListener("click", () => showKeyForm(apiKeyForm.hidden));
chrome.storage.session.get("typesafeApiKey").then(({ typesafeApiKey }) => {
  apiKeyToggle.classList.toggle("configured", Boolean(typesafeApiKey));
}).catch((error) => setStatus(`Could not load API key status: ${error.message}`, true));

apiKeyForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const typesafeApiKey = apiKeyInput.value.trim();
  if (!typesafeApiKey) return;
  try {
    await chrome.storage.session.set({ typesafeApiKey });
    apiKeyInput.value = "";
    apiKeyToggle.classList.add("configured");
    showKeyForm(false);
    setStatus("TypeSafe key saved for this browser session.");
  } catch (error) {
    setStatus(`Could not save API key: ${error.message}`, true);
  }
});

document.getElementById("clearApiKey").addEventListener("click", async () => {
  try {
    await chrome.storage.session.remove("typesafeApiKey");
    apiKeyInput.value = "";
    apiKeyToggle.classList.remove("configured");
    showKeyForm(false);
    setStatus("TypeSafe key cleared. Task sorting is paused.");
  } catch (error) {
    setStatus(`Could not clear API key: ${error.message}`, true);
  }
});

function cleanField(value) {
  return String(value ?? "").replace(/[\t\r\n]+/g, " ").trim();
}

function activityText(events) {
  const header = ["Timestamp (UTC)", "Change", "Tab ID", "Window ID", "Title", "URL", "Group ID", "Pinned", "Favicon URL"];
  const lines = events.map((event) => [
    event.timestamp, event.action.toUpperCase(), event.tabId, event.windowId,
    event.title, event.url, event.groupId, event.pinned, event.favIconUrl
  ].map(cleanField).join("\t"));
  return [header.join("\t"), ...lines].join("\n") + "\n";
}

exportButton.addEventListener("click", async () => {
  exportButton.disabled = true;
  try {
    const events = await TabnoteActivityLog.readEvents();
    const blob = new Blob(["\uFEFF", activityText(events)], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `tabnote-activity-${new Date().toISOString().slice(0, 10)}.txt`;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
    setStatus(`Exported ${events.length} activity records.`);
  } catch (error) {
    setStatus(`Could not export activity: ${error.message}`, true);
  } finally {
    exportButton.disabled = false;
  }
});

function downloadText(filename, contents) {
  const url = URL.createObjectURL(new Blob(["\uFEFF", contents], { type: "text/plain;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

importButton.addEventListener("click", () => importFile.click());
importFile.addEventListener("change", async () => {
  const file = importFile.files?.[0];
  importFile.value = "";
  if (!file) return;
  importButton.disabled = true;
  setStatus("Opening shared tab set…");
  try {
    if (file.size > TabnoteTaskTransfer.MAX_TEXT_LENGTH) throw new Error("Tab set file is too large.");
    const { kind, payload } = TabnoteTaskTransfer.parseAny(await file.text());
    const window = await chrome.windows.getCurrent();
    if (window.type !== "normal") throw new Error("Open a normal browser window before importing.");
    const result = await chrome.runtime.sendMessage({ type: kind === "site" ? "importSiteGroup" : "importTaskGroup", payload, windowId: window.id });
    if (!result?.ok) throw new Error(result?.error || "Unknown error");
    if (kind === "task") tasks = (await chrome.storage.local.get({ tasks: [] })).tasks;
    renderTasks();
    await refreshGroups();
    setStatus(`Opened ${result.summary.count} tabs in ${result.summary.task || result.summary.site}.`);
  } catch (error) {
    setStatus(`Could not import tab set: ${error.message}`, true);
  } finally {
    importButton.disabled = false;
  }
});

function setStatus(message, error = false) {
  status.textContent = message;
  status.title = message;
  status.classList.toggle("error", error);
}

function renderTasks() {
  taskList.replaceChildren();
  if (!tasks.length) {
    const empty = document.createElement("p");
    empty.className = "empty";
    empty.textContent = "No tasks yet. Add your first one.";
    taskList.append(empty);
    return;
  }
  for (const task of tasks) {
    const row = document.createElement("div");
    row.className = "task-row";
    const icon = document.createElement("img");
    icon.className = "group-icon";
    icon.referrerPolicy = "no-referrer";
    icon.addEventListener("error", () => { icon.src = "assets/site.svg"; }, { once: true });
    icon.src = taskIcons[task.id] || "assets/chrome.svg";
    icon.alt = "";
    const name = document.createElement("span");
    name.className = "task-name";
    name.textContent = task.name;
    const sort = document.createElement("button");
    sort.className = "sort-task";
    sort.type = "button";
    sort.innerHTML = ICONS.sort;
    sort.setAttribute("aria-label", `Classify ungrouped tabs for ${task.name}`);
    sort.title = `Classify ungrouped tabs for ${task.name}`;
    sort.addEventListener("click", async () => {
      sort.disabled = true;
      setStatus(`Matching ungrouped tabs to ${task.name}…`);
      try {
        const result = await chrome.runtime.sendMessage({ type: "organizeOneTask", taskId: task.id });
        if (!result?.ok) throw new Error(result?.error || "Unknown error");
        const { checked = 0, matched = 0 } = result.summary || {};
        setStatus(checked
          ? `${matched} of ${checked} ungrouped tabs matched ${task.name}.`
          : `No ungrouped tabs to check for ${task.name}.`);
      } catch (error) {
        if (/API key/i.test(error.message)) showKeyForm(true);
        setStatus(`Could not sort ${task.name}: ${error.message}`, true);
      } finally {
        sort.disabled = false;
      }
    });
    const share = document.createElement("button");
    share.className = "share-task";
    share.type = "button";
    share.innerHTML = ICONS.share;
    share.setAttribute("aria-label", `Export ${task.name} task group as TXT`);
    share.title = `Export ${task.name} task group as TXT`;
    share.addEventListener("click", async () => {
      share.disabled = true;
      try {
        const result = await chrome.runtime.sendMessage({ type: "exportTaskGroup", taskId: task.id });
        if (!result?.ok) throw new Error(result?.error || "Unknown error");
        const payload = result.summary;
        const filename = `tabnote-task-${task.name.replace(/[^\p{L}\p{N} _-]/gu, "").trim().replace(/\s+/g, "-").slice(0, 52) || "shared"}.txt`;
        downloadText(filename, TabnoteTaskTransfer.serialize(payload));
        setStatus(`Exported ${payload.tabs.length} tabs from ${task.name}.`);
      } catch (error) {
        setStatus(`Could not export ${task.name}: ${error.message}`, true);
      } finally {
        share.disabled = false;
      }
    });
    const edit = document.createElement("button");
    edit.className = "edit-task";
    edit.type = "button";
    edit.innerHTML = ICONS.edit;
    edit.setAttribute("aria-label", `Rename ${task.name}`);
    edit.title = `Rename ${task.name}`;
    edit.addEventListener("click", () => {
      const input = document.createElement("input");
      input.className = "task-edit-input";
      input.value = task.name;
      input.setAttribute("aria-label", `New name for ${task.name}`);
      name.replaceWith(input);
      input.focus();
      input.select();
      let saving = false;
      function cancel() {
        if (!saving && input.isConnected) input.replaceWith(name);
      }
      input.addEventListener("blur", cancel);
      input.addEventListener("keydown", async (event) => {
        if (event.key === "Escape") return cancel();
        if (event.key !== "Enter" || saving) return;
        event.preventDefault();
        saving = true;
        edit.disabled = true;
        const newName = input.value.trim().replace(/\s+/g, " ");
        try {
          const result = await chrome.runtime.sendMessage({ type: "renameTask", taskId: task.id, name: newName });
          if (!result?.ok) throw new Error(result?.error || "Unknown error");
          tasks = result.summary;
          renderTasks();
          setStatus("Task renamed. Its grouped tabs stayed in place.");
        } catch (error) {
          saving = false;
          edit.disabled = false;
          setStatus(`Could not rename task: ${error.message}`, true);
          input.focus();
        }
      });
    });
    const remove = document.createElement("button");
    remove.className = "remove-task";
    remove.type = "button";
    remove.innerHTML = ICONS.remove;
    remove.setAttribute("aria-label", `Remove ${task.name}`);
    remove.title = `Remove ${task.name}`;
    remove.addEventListener("click", async () => {
      remove.disabled = true;
      setStatus("Removing task and its tab group…");
      try {
        const result = await chrome.runtime.sendMessage({ type: "removeTask", taskId: task.id });
        if (!result?.ok) throw new Error(result?.error || "Unknown error");
        tasks = tasks.filter((item) => item.id !== task.id);
        renderTasks();
        setStatus("Task removed. Manually placed tabs stay grouped.");
      } catch (error) {
        remove.disabled = false;
        setStatus(`Could not remove task: ${error.message}`, true);
      }
    });
    row.append(icon, name, sort, share, edit, remove);
    taskList.append(row);
  }
}

function displaySiteName(group) {
  if (group.label && group.label !== group.site) return group.label;
  const parts = group.site.split(".");
  return parts.length >= 2 ? parts[parts.length - 2] : group.site;
}

function siteButton(icon, label, handler) {
  const button = document.createElement("button");
  button.className = "site-action";
  button.type = "button";
  button.innerHTML = ICONS[icon];
  button.setAttribute("aria-label", label);
  button.title = label;
  button.addEventListener("click", async () => {
    button.disabled = true;
    try { await handler(); } catch (error) { setStatus(error.message, true); }
    finally { button.disabled = false; }
  });
  return button;
}

async function refreshGroups() {
  const serial = ++refreshSerial;
  try {
    const result = await chrome.runtime.sendMessage({ type: "popupGroups" });
    if (!result?.ok) throw new Error(result?.error || "Unknown error");
    if (serial !== refreshSerial) return;
    const { sites = [], taskIcons: icons = {}, autoSite: enabled = false } = result.summary || {};
    if (JSON.stringify(taskIcons) !== JSON.stringify(icons)) {
      taskIcons = icons;
      renderTasks();
    }
    autoSite.checked = enabled;
    if (!siteSwitch.classList.contains("ready")) {
      siteSwitch.getBoundingClientRect(); // Apply the saved state before enabling transitions.
      siteSwitch.classList.add("ready");
    }
    siteList.replaceChildren();
    if (!sites.length) {
      const empty = document.createElement("p");
      empty.className = "empty";
      empty.textContent = "No site groups yet.";
      siteList.append(empty);
    }
    for (const group of sites) {
      const row = document.createElement("div");
      row.className = "site-row";
      const icon = document.createElement("img");
      icon.className = "group-icon";
      icon.alt = "";
      icon.referrerPolicy = "no-referrer";
      icon.addEventListener("error", () => { icon.src = "assets/site.svg"; }, { once: true });
      icon.src = group.favicon || "assets/site.svg";
      const name = document.createElement("span");
      name.className = "site-name";
      name.textContent = displaySiteName(group);
      name.title = group.site;
      const sort = siteButton("sort", `Group ungrouped ${group.site} tabs`, async () => {
        const result = await chrome.runtime.sendMessage({ type: "sortOneSite", groupId: group.id });
        if (!result?.ok) throw new Error(result?.error || "Could not group site tabs.");
        await refreshGroups();
        setStatus(`Grouped available tabs for ${group.site}.`);
      });
      const share = siteButton("share", `Export ${group.site} tab set as TXT`, async () => {
        const result = await chrome.runtime.sendMessage({ type: "exportSiteGroup", groupId: group.id });
        if (!result?.ok) throw new Error(result?.error || "Could not export site tabs.");
        downloadText(`tabnote-site-${group.site.replace(/[^a-z0-9.-]/gi, "").slice(0, 52)}.txt`,
          TabnoteTaskTransfer.serializeSite(result.summary));
        setStatus(`Exported ${result.summary.tabs.length} tabs from ${group.site}.`);
      });
      const edit = siteButton("edit", `Rename ${group.site} group`, async () => {
        const input = document.createElement("input");
        input.className = "task-edit-input";
        input.maxLength = 52;
        input.value = group.label || group.site;
        input.setAttribute("aria-label", `New group name for ${group.site}`);
        name.replaceWith(input);
        input.focus();
        input.select();
        let saving = false;
        const cancel = () => { if (!saving && input.isConnected) input.replaceWith(name); };
        input.addEventListener("blur", cancel);
        input.addEventListener("keydown", async (event) => {
          if (event.key === "Escape") return cancel();
          if (event.key !== "Enter" || saving) return;
          event.preventDefault();
          saving = true;
          try {
            const result = await chrome.runtime.sendMessage({ type: "renameSiteGroup", groupId: group.id, name: input.value });
            if (!result?.ok) throw new Error(result?.error || "Could not rename site group.");
            await refreshGroups();
            setStatus(`Renamed ${group.site} group.`);
          } catch (error) {
            saving = false;
            setStatus(error.message, true);
            input.focus();
          }
        });
      });
      const remove = siteButton("remove", `Remove ${group.site} group`, async () => {
        const result = await chrome.runtime.sendMessage({ type: "removeSiteGroup", groupId: group.id });
        if (!result?.ok) throw new Error(result?.error || "Could not remove site group.");
        await refreshGroups();
        setStatus(result.summary.preserved
          ? `Removed automatic tabs; ${result.summary.preserved} manually placed tabs stayed grouped.`
          : `Removed ${group.site} group. Tabs stayed open.`);
      });
      row.append(icon, name, sort, share, edit, remove);
      siteList.append(row);
    }
  } catch (error) {
    setStatus(`Could not load groups: ${error.message}`, true);
  }
}

function scheduleRefresh() {
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(refreshGroups, 120);
}

async function resetGroups() {
  resetButton.disabled = true;
  setStatus("Resetting groups…");
  try {
    const result = await chrome.runtime.sendMessage({ type: "restoreTabs" });
    if (!result?.ok) throw new Error(result?.error || "Unknown error");
    setStatus("All groups removed. Web tabs stay open.");
    await refreshGroups();
  } catch (error) {
    setStatus(`Could not finish: ${error.message}`, true);
  } finally {
    resetButton.disabled = false;
  }
}

chrome.storage.local.get({ tasks: [] }).then((saved) => {
  tasks = saved.tasks;
  renderTasks();
}).catch((error) => setStatus(`Could not load tasks: ${error.message}`, true));
refreshGroups();
chrome.tabGroups.onCreated.addListener(scheduleRefresh);
chrome.tabGroups.onRemoved.addListener(scheduleRefresh);
chrome.tabGroups.onUpdated.addListener(scheduleRefresh);
chrome.tabs.onUpdated.addListener((_id, change) => {
  if (change.favIconUrl || Object.hasOwn(change, "groupId")) scheduleRefresh();
});
chrome.tabs.onRemoved.addListener(scheduleRefresh);
chrome.tabs.onMoved.addListener(scheduleRefresh);
chrome.tabs.onAttached.addListener(scheduleRefresh);

taskForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const name = taskInput.value.trim().replace(/\s+/g, " ");
  if (!name) return;
  if (tasks.some((task) => task.name.toLowerCase() === name.toLowerCase())) {
    setStatus("That task already exists.", true);
    return;
  }
  taskInput.disabled = true;
  addButton.disabled = true;
  try {
    const window = await chrome.windows.getCurrent();
    if (window.type !== "normal") throw new Error("Open a normal browser window to add a task.");
    const result = await chrome.runtime.sendMessage({ type: "addTask", name, windowId: window.id });
    if (!result?.ok) throw new Error(result?.error || "Could not add task.");
    tasks = (await chrome.storage.local.get({ tasks: [] })).tasks;
    taskInput.value = "";
    renderTasks();
    await refreshGroups();
    setStatus("Task group ready. Move tabs in or use Sort.");
  } catch (error) {
    setStatus(`Could not add task: ${error.message}`, true);
  } finally {
    taskInput.disabled = false;
    addButton.disabled = false;
  }
});

autoSite.addEventListener("change", async () => {
  const enabled = autoSite.checked;
  autoSite.disabled = true;
  setStatus(enabled ? "Grouping tabs by website…" : "Automatic site grouping is off.");
  try {
    const result = await chrome.runtime.sendMessage({ type: "setAutoSite", enabled });
    if (!result?.ok) throw new Error(result?.error || "Could not change automatic grouping.");
    await refreshGroups();
    setStatus(enabled ? "Site groups updated. New tabs will be grouped automatically." : "Automatic site grouping is off.");
  } catch (error) {
    autoSite.checked = !enabled;
    setStatus(`Could not change site grouping: ${error.message}`, true);
  } finally {
    autoSite.disabled = false;
  }
});
resetButton.addEventListener("click", resetGroups);
