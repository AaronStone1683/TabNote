<h1 align="center"><img src="assets/readme-logo.svg" alt="Tabnote icon" width="30" height="30"> Tabnote</h1>

<p align="center"><strong>Give your tabs a place to belong.</strong><br>Group open Chrome tabs by website or task, keep your own edits, and share a task's pages as a tab set.</p>

<p align="center">
  <a href="manifest.json"><img src="https://img.shields.io/badge/v0.19.4-059669?style=flat-square" alt="Version 0.19.4"></a>
  <a href="manifest.json"><img src="https://img.shields.io/badge/Chrome%20102%2B-2563EB?style=flat-square&amp;logo=googlechrome&amp;logoColor=white" alt="Chrome 102 or newer"></a>
  <a href="manifest.json"><img src="https://img.shields.io/badge/Manifest%20V3-7C3AED?style=flat-square" alt="Manifest V3"></a>
</p>

<p align="center">
  <a href="README.md"><strong>English</strong></a> ·
  <a href="README.zh-CN.md">简体中文</a>
</p>

<p align="center">
  <a href="https://github.com/AaronStone1683/TabNote/releases/download/v0.19.4/tabnote-v0.19.4.zip"><strong>⬇ Download Tabnote v0.19.4 (.zip)</strong></a>
</p>

<p align="center">
  <a href="#get-started">Get started</a> ·
  <a href="#what-you-can-do">What you can do</a> ·
  <a href="#share-a-tab-set">Share a tab set</a> ·
  <a href="#privacy">Privacy</a>
</p>

The popup puts **Sites** and its automatic grouping switch above **Tasks**. Each site and task row has buttons to sort, export, rename, and remove its group.

## A simple workflow

**Name a task → move tabs into its new group by hand or use Sort → export the task's tab set.**

Tabnote groups pages in Chrome's native tab strip. It remembers manual moves and previous task decisions, so sorting again focuses on tabs that still need a decision. Sorting leaves existing groups in place; **Reset** removes all groups.

## Get started

Tabnote currently runs as a local Chrome extension. No account or build step is required.

1. [Download the extension ZIP](https://github.com/AaronStone1683/TabNote/releases/download/v0.19.4/tabnote-v0.19.4.zip) and extract it, or clone this repository.
2. Open `chrome://extensions` in Chrome 102 or newer and enable **Developer mode**.
3. Click **Load unpacked** and select the extracted folder containing `manifest.json`.
4. Pin Tabnote to the toolbar and open the popup.
5. Turn on **Auto group** beside Sites for immediate local website grouping and automatic sorting of new tabs. Adding a task creates a Chrome group immediately; move tabs into it manually, or set a TypeSafe API key and click that task's sort icon.

> [!IMPORTANT]
> A TypeSafe API key is needed only for task decisions that are not already saved. Site grouping, activity history, and tab-set import/export work without one.

## What you can do

| In the popup | Result |
| --- | --- |
| **Tasks · Add a task...** | Create a named task and an immediate Chrome group with a temporary blank tab. Move pages in by hand or use Sort; the temporary tab closes when the first real page enters. |
| **Tab Set** | Upload a shared task or website TXT file to open its pages in a group. The upload button sits beside the task input. |
| **Sites · Auto group** | Off by default. Turning it on groups eligible tabs across open windows, then groups new tabs by website. A site needs at least two tabs to form a new group. New groups get varied Chrome colors. |
| **Site row buttons** | Group remaining tabs for that site, export its open tabs as a TXT, rename its group, or remove its automatically placed tabs. |
| **Task row sort icon** | Compare ungrouped tab titles with that task using TypeSafe System One, then group confident matches. |
| **Task row remove icon** | Delete the task and ungroup only its tabs. Web pages stay open; an unused blank placeholder closes. |
| **Reset** | Remove all Chrome tab groups, including groups that existed before Tabnote was installed, and pause automatic site sorting. Web tabs stay open; temporary task placeholders close. |
| **History** | Download a TXT activity log of tabs added and closed, with timestamps and tab details. |

After you turn on website grouping, Tabnote also sorts eligible new or updated tabs by site. If an automatically grouped tab navigates to a different website, it leaves the old site group and can join a group for the new website. Tabs you placed in a group by hand stay there. Task sorting runs when you click a task's sort icon; manual task grouping needs no API key. It leaves tabs in existing groups alone. Task decisions are saved by title and task; a repeat decision uses the saved result instead of calling the API again. The match threshold is 0.50. Uncertain pages stay ungrouped. Moving a tab into a task group by hand records your preference for future sorting.

The popup lists open website groups under **Sites**, showing each site's favicon and the second-to-last part of its hostname. New Chrome website groups use the same short name. Task rows use the first web tab's favicon when available. Renaming or recoloring a Chrome group keeps it connected to Tabnote. Native Chrome tab group labels cannot display image icons.

## Share a tab set

Click the **download icon beside a task** to export the web tabs currently open in that task group, across Chrome windows. The TXT contains the task name and each tab's title and URL:

```text
Tabnote Task Group v1
Task: "Review paper"
Tabs:
{"title":"Conference guidelines","url":"https://example.org/guidelines"}
{"title":"Related work","url":"https://example.org/paper"}
```

Send that file to someone using Tabnote. They can click **Tab Set** beside the task input to open its pages and create or reuse the named group. The file is read locally; importing does not require an API key. Upload accepts up to 500 HTTP(S) pages.

Website groups can also be exported from their row. A website TXT stores the hostname, group label, and tabs; importing it creates or reuses a website group. Removing a site group keeps manually placed tabs in their group. Deleting a task ungroups all of its tabs while leaving the web pages open. **Reset** removes every Chrome tab group, including groups that existed before Tabnote and those containing manually placed tabs.

> [!NOTE]
> Check a TXT before sharing it: titles and full URLs may contain private information. The TXT from **History** uses a different format and cannot be uploaded as a tab set.

## Privacy

| Data | Storage or destination |
| --- | --- |
| Tasks, site sorting setting, and group identities | Chrome local storage on your device |
| Saved task decisions, manual placements, and tab activity | IndexedDB on your device |
| TypeSafe API key | Chrome session storage; cleared at the end of the browser session |
| New task classification decisions | Page **title** and task **names** sent to TypeSafe System One |
| Exported TXT | Downloaded to your device |

Tabnote does not send page URLs or page content to TypeSafe. Site grouping and activity logging run locally. Logging begins when the extension is installed; exporting the history does not clear it.

## Troubleshooting

For task sorting details, open `chrome://extensions`, find Tabnote, and inspect its **Service worker**. Messages beginning with `[Tabnote]` show API requests, saved decisions, scores, and errors. Pinned tabs, tabs already in groups, internal browser pages, and pages still loading are not classified.

After editing extension files locally, click **Reload** on Tabnote's card in `chrome://extensions`.

If you cloned the repository, run `node tests/grouping.cjs` and `node tests/tab-transfer.cjs` for the local behavior checks.

## Project status

Tabnote is a local prototype and has not been publicly licensed yet. A license is needed before presenting the source as an open-source release.
