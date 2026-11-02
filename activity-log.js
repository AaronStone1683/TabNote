// Shared by the service worker and popup. IndexedDB keeps the event history
// and last-known tab details across service worker restarts.
globalThis.TabnoteActivityLog = (() => {
  const DB_NAME = "tabnote-activity";
  const DB_VERSION = 1;
  let databasePromise;

  function openDatabase() {
    if (!databasePromise) {
      databasePromise = new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);
        request.onupgradeneeded = () => {
          const database = request.result;
          database.createObjectStore("events", { keyPath: "id", autoIncrement: true });
          database.createObjectStore("tabs", { keyPath: "id" });
        };
        request.onsuccess = () => {
          const database = request.result;
          database.onversionchange = () => {
            database.close();
            databasePromise = undefined;
          };
          resolve(database);
        };
        request.onerror = () => reject(request.error);
      }).catch((error) => {
        databasePromise = undefined;
        throw error;
      });
    }
    return databasePromise;
  }

  function details(tab) {
    return {
      tabId: tab.id,
      windowId: tab.windowId,
      title: tab.title || "",
      url: tab.url || tab.pendingUrl || "",
      favIconUrl: tab.favIconUrl || "",
      pinned: Boolean(tab.pinned),
      groupId: Number.isInteger(tab.groupId) ? tab.groupId : -1
    };
  }

  function isPlaceholderUrl(url) {
    return !url || /^(?:about:blank|chrome:\/\/newtab\/?|chrome:\/\/new-tab-page\/?)$/i.test(url);
  }

  function hasLoadedPage(tab) {
    return tab.status === "complete" && Boolean(tab.title) && !isPlaceholderUrl(tab.url || tab.pendingUrl);
  }

  async function recordAdded(tab, timestamp = new Date().toISOString()) {
    const database = await openDatabase();
    return new Promise((resolve, reject) => {
      const transaction = database.transaction(["events", "tabs"], "readwrite");
      const event = { timestamp, action: "added", ...details(tab) };
      const request = transaction.objectStore("events").add(event);
      request.onsuccess = () => {
        transaction.objectStore("tabs").put({
          id: tab.id,
          ...details(tab),
          addedEventId: request.result,
          enrichAddedEvent: !hasLoadedPage(tab)
        });
      };
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  }

  async function updateSnapshot(tab) {
    const database = await openDatabase();
    return new Promise((resolve, reject) => {
      const transaction = database.transaction(["events", "tabs"], "readwrite");
      const snapshots = transaction.objectStore("tabs");
      const request = snapshots.get(tab.id);
      request.onsuccess = () => {
        const previous = request.result || { id: tab.id };
        const latest = { ...previous, ...details(tab) };
        if (previous.addedEventId && previous.enrichAddedEvent) {
          const events = transaction.objectStore("events");
          const eventRequest = events.get(previous.addedEventId);
          eventRequest.onsuccess = () => {
            if (eventRequest.result) events.put({ ...eventRequest.result, ...details(tab) });
          };
        }
        if (hasLoadedPage(tab)) {
          latest.enrichAddedEvent = false;
        }
        snapshots.put(latest);
      };
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  }

  async function recordClosed(tabId, removeInfo, timestamp = new Date().toISOString()) {
    const database = await openDatabase();
    return new Promise((resolve, reject) => {
      const transaction = database.transaction(["events", "tabs"], "readwrite");
      const snapshots = transaction.objectStore("tabs");
      const request = snapshots.get(tabId);
      request.onsuccess = () => {
        const last = request.result || { tabId, windowId: removeInfo.windowId };
        transaction.objectStore("events").add({
          timestamp,
          action: "closed",
          tabId,
          windowId: last.windowId ?? removeInfo.windowId,
          title: last.title || "",
          url: last.url || "",
          favIconUrl: last.favIconUrl || "",
          pinned: Boolean(last.pinned),
          groupId: Number.isInteger(last.groupId) ? last.groupId : -1
        });
        snapshots.delete(tabId);
      };
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  }

  async function seedSnapshots(tabs) {
    const database = await openDatabase();
    return new Promise((resolve, reject) => {
      const transaction = database.transaction("tabs", "readwrite");
      const snapshots = transaction.objectStore("tabs");
      snapshots.clear();
      for (const tab of tabs) snapshots.put({ id: tab.id, ...details(tab) });
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  }

  async function readEvents() {
    const database = await openDatabase();
    return new Promise((resolve, reject) => {
      const transaction = database.transaction("events", "readonly");
      const request = transaction.objectStore("events").getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  return { recordAdded, updateSnapshot, recordClosed, seedSnapshots, readEvents };
})();
