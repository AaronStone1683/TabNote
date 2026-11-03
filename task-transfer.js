// A small, versioned text format for sharing one task and its open web tabs.
const TabnoteTaskTransfer = (() => {
  const HEADER = "Tabnote Task Group v1";
  const SITE_HEADER = "Tabnote Site Group v1";
  const MAX_TABS = 500;
  const MAX_TEXT_LENGTH = 1_000_000;

  function validate(payload) {
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new Error("Invalid task group file.");
    const name = payload.task;
    if (typeof name !== "string" || !name.trim() || name !== name.trim() || name.length > 52 || /[\r\n\t]/.test(name)) {
      throw new Error("Invalid task name in file.");
    }
    if (!Array.isArray(payload.tabs) || !payload.tabs.length || payload.tabs.length > MAX_TABS) {
      throw new Error(`A task group must contain 1–${MAX_TABS} web tabs.`);
    }
    const tabs = payload.tabs.map((tab) => {
      if (!tab || typeof tab !== "object" || Array.isArray(tab) || typeof tab.url !== "string" ||
          typeof tab.title !== "string" || tab.title.length > 1000 || tab.url.length > 8192) {
        throw new Error("Invalid tab entry in file.");
      }
      let url;
      try { url = new URL(tab.url); } catch { throw new Error("Invalid web URL in file."); }
      if (!["http:", "https:"].includes(url.protocol) || !url.hostname || url.username || url.password) {
        throw new Error("Only HTTP(S) web URLs without embedded credentials can be imported.");
      }
      return { title: tab.title, url: tab.url };
    });
    return { task: name, tabs };
  }

  function serialize(payload) {
    const { task, tabs } = validate(payload);
    return [HEADER, `Task: ${JSON.stringify(task)}`, "Tabs:",
      ...tabs.map((tab) => JSON.stringify(tab))].join("\n") + "\n";
  }

  function parse(text) {
    if (typeof text !== "string" || text.length > MAX_TEXT_LENGTH) throw new Error("Task group file is too large.");
    const lines = text.replace(/^\uFEFF/, "").trimEnd().split(/\r?\n/);
    if (lines[0] !== HEADER || !lines[1]?.startsWith("Task: ") || lines[2] !== "Tabs:") {
      throw new Error("This is not a Tabnote task group TXT file.");
    }
    let task, tabs;
    try {
      task = JSON.parse(lines[1].slice(6));
      tabs = lines.slice(3).map((line) => JSON.parse(line));
    } catch {
      throw new Error("Task group TXT file is malformed.");
    }
    return validate({ task, tabs });
  }

  function validateSite(payload) {
    if (!payload || typeof payload !== "object" || Array.isArray(payload) || typeof payload.site !== "string" ||
        !payload.site || payload.site.length > 253 || /[\s/?#@]/.test(payload.site)) {
      throw new Error("Invalid website in tab set.");
    }
    const site = payload.site.toLowerCase();
    try {
      const parsed = new URL(`https://${site}/`);
      if (parsed.hostname !== site || parsed.port || parsed.username || parsed.password) throw new Error();
    } catch { throw new Error("Invalid website in tab set."); }
    if (typeof payload.label !== "string" || !payload.label.trim() || payload.label !== payload.label.trim() ||
        payload.label.length > 253 || /[\r\n\t]/.test(payload.label)) {
      throw new Error("Invalid site group label in file.");
    }
    const checked = validate({ task: "site", tabs: payload.tabs });
    return { site, label: payload.label, tabs: checked.tabs };
  }

  function serializeSite(payload) {
    const { site, label, tabs } = validateSite(payload);
    return [SITE_HEADER, `Site: ${JSON.stringify(site)}`, `Label: ${JSON.stringify(label)}`, "Tabs:",
      ...tabs.map((tab) => JSON.stringify(tab))].join("\n") + "\n";
  }

  function parseSite(text) {
    if (typeof text !== "string" || text.length > MAX_TEXT_LENGTH) throw new Error("Tab set file is too large.");
    const lines = text.replace(/^\uFEFF/, "").trimEnd().split(/\r?\n/);
    if (lines[0] !== SITE_HEADER || !lines[1]?.startsWith("Site: ") ||
        !lines[2]?.startsWith("Label: ") || lines[3] !== "Tabs:") {
      throw new Error("This is not a Tabnote site group TXT file.");
    }
    try {
      return validateSite({ site: JSON.parse(lines[1].slice(6)), label: JSON.parse(lines[2].slice(7)),
        tabs: lines.slice(4).map((line) => JSON.parse(line)) });
    } catch {
      throw new Error("Site group TXT file is malformed.");
    }
  }

  function parseAny(text) {
    const header = String(text).replace(/^\uFEFF/, "").split(/\r?\n/, 1)[0];
    if (header === HEADER) return { kind: "task", payload: parse(text) };
    if (header === SITE_HEADER) return { kind: "site", payload: parseSite(text) };
    throw new Error("This is not a Tabnote tab set TXT file.");
  }

  return { HEADER, SITE_HEADER, MAX_TABS, MAX_TEXT_LENGTH, validate, serialize, parse,
    validateSite, serializeSite, parseSite, parseAny };
})();
