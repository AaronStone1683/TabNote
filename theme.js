const colorScheme = matchMedia("(prefers-color-scheme: dark)");

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "tabnote:getColorScheme") {
    sendResponse({ dark: colorScheme.matches });
  }
});

colorScheme.addEventListener("change", () => {
  chrome.runtime.sendMessage({ type: "tabnote:colorSchemeChanged", dark: colorScheme.matches })
    .catch((error) => console.warn("Tabnote icon color could not be updated:", error));
});
