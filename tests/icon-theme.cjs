const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.join(__dirname, "..");
const offscreenUrl = "chrome-extension://test/theme.html";
const listeners = [];
const selectedIcons = [];
let offscreenCreated = false;
let schemeChange;
const preference = {
  matches: true,
  addEventListener(type, listener) {
    assert.equal(type, "change");
    schemeChange = listener;
  }
};

function dispatch(sourceUrl, message) {
  let response;
  for (const listener of listeners) {
    listener(message, { url: sourceUrl }, (value) => { response = value; });
  }
  return Promise.resolve(response);
}

function event() { return { addListener() {} }; }

const chrome = {
  action: { setIcon: async ({ path: iconPaths }) => { selectedIcons.push(iconPaths); } },
  offscreen: {
    createDocument: async ({ url, reasons }) => {
      assert.equal(url, "theme.html");
      assert.deepEqual(Array.from(reasons), ["MATCH_MEDIA"]);
      offscreenCreated = true;
      vm.runInNewContext(fs.readFileSync(path.join(root, "theme.js"), "utf8"), {
        matchMedia: (query) => {
          assert.equal(query, "(prefers-color-scheme: dark)");
          return preference;
        },
        chrome: { runtime: {
          onMessage: { addListener: (listener) => listeners.push(listener) },
          sendMessage: (message) => dispatch(offscreenUrl, message)
        } },
        console
      });
    }
  },
  runtime: {
    getURL: (file) => `chrome-extension://test/${file}`,
    getContexts: async () => offscreenCreated ? [{}] : [],
    sendMessage: (message) => dispatch("chrome-extension://test/background.js", message),
    onInstalled: event(), onStartup: event(),
    onMessage: { addListener: (listener) => listeners.push(listener) }
  },
  tabs: { onCreated: event(), onUpdated: event(), onMoved: event(), onAttached: event(), onRemoved: event() },
  tabGroups: { onCreated: event(), onUpdated: event(), onRemoved: event() }
};

vm.runInNewContext(fs.readFileSync(path.join(root, "background.js"), "utf8"), {
  chrome, importScripts() {}, console, URL, setTimeout, clearTimeout
});

(async () => {
  await new Promise(setImmediate);
  assert.equal(offscreenCreated, true);
  assert.equal(selectedIcons.at(-1)[16], "icons/icon16.png", "dark preference uses the white icon");
  assert.equal(selectedIcons.at(-1)[128], "icons/icon128.png");

  preference.matches = false;
  schemeChange();
  await new Promise(setImmediate);
  assert.equal(selectedIcons.at(-1)[16], "icons/icon-dark16.png", "light preference uses the dark icon");
  assert.equal(selectedIcons.at(-1)[128], "icons/icon-dark128.png");
  console.log("Toolbar icon follows light and dark preference changes.");
})().catch((error) => { console.error(error); process.exitCode = 1; });
