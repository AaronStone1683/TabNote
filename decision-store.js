// Persistent title × task decisions. The API key is never stored here.
globalThis.TabnoteDecisionStore = (() => {
  const DB_NAME = "tabnote-decisions";
  const DB_VERSION = 3;
  let databasePromise;

  function openDatabase() {
    if (!databasePromise) {
      databasePromise = new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);
        request.onupgradeneeded = (event) => {
          if (event.oldVersion < 1) {
            const store = request.result.createObjectStore("decisions", { keyPath: "key" });
            store.createIndex("taskId", "taskId");
          }
          if (event.oldVersion < 2) {
            request.result.createObjectStore("manual", { keyPath: "tabId" });
          }
          if (event.oldVersion < 3) {
            const store = request.result.createObjectStore("assignments", { keyPath: "url" });
            store.createIndex("taskId", "taskId");
          }
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

  function decisionKey(title, task, model, promptVersion) {
    const normalizedTitle = title.trim().replace(/\s+/g, " ").toLocaleLowerCase();
    return JSON.stringify([model, promptVersion, normalizedTitle, task.id, task.name]);
  }

  async function getMany(title, tasks, model, promptVersion) {
    if (!tasks.length) return new Map();
    const database = await openDatabase();
    return new Promise((resolve, reject) => {
      const transaction = database.transaction("decisions", "readonly");
      const store = transaction.objectStore("decisions");
      const found = new Map();
      for (const task of tasks) {
        const request = store.get(decisionKey(title, task, model, promptVersion));
        request.onsuccess = () => {
          if (request.result) found.set(task.id, request.result.score);
        };
      }
      transaction.oncomplete = () => resolve(found);
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  }

  async function putMany(title, scored, model, promptVersion) {
    if (!scored.length) return;
    const database = await openDatabase();
    return new Promise((resolve, reject) => {
      const transaction = database.transaction("decisions", "readwrite");
      const store = transaction.objectStore("decisions");
      for (const { task, score } of scored) {
        store.put({
          key: decisionKey(title, task, model, promptVersion),
          taskId: task.id,
          score,
          evaluatedAt: new Date().toISOString()
        });
      }
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  }

  async function deleteTask(taskId) {
    const database = await openDatabase();
    return new Promise((resolve, reject) => {
      const transaction = database.transaction("decisions", "readwrite");
      const store = transaction.objectStore("decisions");
      const request = store.index("taskId").openKeyCursor(IDBKeyRange.only(taskId));
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) return;
        store.delete(cursor.primaryKey);
        cursor.continue();
      };
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  }

  async function getManual(tabIds) {
    if (!tabIds.length) return new Map();
    const database = await openDatabase();
    return new Promise((resolve, reject) => {
      const transaction = database.transaction("manual", "readonly");
      const store = transaction.objectStore("manual");
      const found = new Map();
      for (const tabId of tabIds) {
        const request = store.get(tabId);
        request.onsuccess = () => {
          if (request.result) found.set(tabId, request.result);
        };
      }
      transaction.oncomplete = () => resolve(found);
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  }

  async function getAllManual() {
    const database = await openDatabase();
    return new Promise((resolve, reject) => {
      const transaction = database.transaction("manual", "readonly");
      const request = transaction.objectStore("manual").getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async function setManual(tabId, groupId, windowId, title = "", url = "") {
    const database = await openDatabase();
    return new Promise((resolve, reject) => {
      const transaction = database.transaction("manual", "readwrite");
      transaction.objectStore("manual").put({ tabId, groupId, windowId, title, url });
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  }

  async function deleteManual(tabId) {
    const database = await openDatabase();
    return new Promise((resolve, reject) => {
      const transaction = database.transaction("manual", "readwrite");
      transaction.objectStore("manual").delete(tabId);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  }

  async function clearManual() {
    const database = await openDatabase();
    return new Promise((resolve, reject) => {
      const transaction = database.transaction("manual", "readwrite");
      transaction.objectStore("manual").clear();
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  }

  async function getAssignments(urls) {
    const unique = [...new Set(urls.filter(Boolean))];
    if (!unique.length) return new Map();
    const database = await openDatabase();
    return new Promise((resolve, reject) => {
      const transaction = database.transaction("assignments", "readonly");
      const store = transaction.objectStore("assignments");
      const found = new Map();
      for (const url of unique) {
        const request = store.get(url);
        request.onsuccess = () => {
          if (request.result) found.set(url, request.result.taskId);
        };
      }
      transaction.oncomplete = () => resolve(found);
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  }

  async function setAssignment(url, taskId) {
    if (!url) return;
    const database = await openDatabase();
    return new Promise((resolve, reject) => {
      const transaction = database.transaction("assignments", "readwrite");
      transaction.objectStore("assignments").put({ url, taskId, assignedAt: new Date().toISOString() });
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  }

  async function deleteAssignment(url) {
    if (!url) return;
    const database = await openDatabase();
    return new Promise((resolve, reject) => {
      const transaction = database.transaction("assignments", "readwrite");
      transaction.objectStore("assignments").delete(url);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  }

  async function deleteAssignmentsForTask(taskId) {
    const database = await openDatabase();
    return new Promise((resolve, reject) => {
      const transaction = database.transaction("assignments", "readwrite");
      const store = transaction.objectStore("assignments");
      const request = store.index("taskId").openKeyCursor(IDBKeyRange.only(taskId));
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) return;
        store.delete(cursor.primaryKey);
        cursor.continue();
      };
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  }

  return { getMany, putMany, deleteTask, getManual, getAllManual, setManual, deleteManual, clearManual,
    getAssignments, setAssignment, deleteAssignment, deleteAssignmentsForTask };
})();
