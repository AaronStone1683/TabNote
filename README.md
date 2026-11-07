<h1 align="center"><img src="assets/readme-logo.svg" alt="Tabnote icon" width="30" height="30"> Tabnote</h1>

<p align="center"><strong>Give your tabs a place to belong.</strong><br>One switch for websites. One click for a task. One file to bring the whole set back.</p>

<p align="center">
  <a href="manifest.json"><img src="https://img.shields.io/badge/v0.19.8-059669?style=flat-square" alt="Version 0.19.8"></a>
  <a href="manifest.json"><img src="https://img.shields.io/badge/Chrome%20109%2B-2563EB?style=flat-square&amp;logo=googlechrome&amp;logoColor=white" alt="Chrome 109 or newer"></a>
  <a href="manifest.json"><img src="https://img.shields.io/badge/Manifest%20V3-7C3AED?style=flat-square" alt="Manifest V3"></a>
</p>

<p align="center"><a href="README.md"><strong>English</strong></a> · <a href="README.zh-CN.md">简体中文</a></p>
<p align="center"><a href="https://github.com/AaronStone1683/TabNote/releases/download/v0.19.8/tabnote-v0.19.8.zip"><strong>⬇ Download Tabnote for Chrome</strong></a></p>

## Watch your tabs fall into place

Turn on **Auto group**. Tabs from the same site gather into Chrome's native groups, and new tabs follow as you browse.

https://github.com/user-attachments/assets/1e0fde4d-4111-41aa-a966-eccc68d3d9f2

### Give a task its own space

Create a task, then use its sort button to collect related pages. Move any tab by hand whenever you know better.

https://github.com/user-attachments/assets/c861dc11-de02-4900-985a-b81a5c2fd67f

### Bring the whole set back

Export a task's tabs as a **Tab Set**. Share the TXT or import it later to reopen the pages and their group.

https://github.com/user-attachments/assets/2e313bda-b7a9-4473-ba92-71368c3aa4fd

## Made for how you actually browse

- **Your moves come first.** Tabs you put into a group by hand stay there during automatic sorting.
- **Pick up where you left off.** Saved task decisions avoid repeat classification; a Tab Set lets someone else reopen the same pages.
- **Stay in Chrome.** Groups are native Chrome tab groups. Rename or recolor them without losing Tabnote's connection.
- **Start without an API key.** Website grouping and local task matching work right away. TypeSafe System One is optional for task classification.

## Try it

1. [Download the ZIP](https://github.com/AaronStone1683/TabNote/releases/download/v0.19.8/tabnote-v0.19.8.zip) and extract it.
2. In Chrome 109+, open `chrome://extensions`, enable **Developer mode**, and choose **Load unpacked**.
3. Select the folder containing `manifest.json`, then pin and open Tabnote.
4. Turn on **Auto group** under **Sites**, or add a **Task** and sort its tabs.

| In the popup | What it does |
| --- | --- |
| **Sites · Auto group** | Groups open and newly opened pages by website. Off by default. |
| **Tasks · Add a task** | Creates a group immediately. Move tabs into it yourself or use its sort button. |
| **Tab Set** | Imports a shared TXT and opens its saved pages in a group. |
| **History** | Exports a TXT log of added and closed tabs. |
| **Reset** | Removes all Chrome tab groups while keeping your web pages open. |

Each site and task row also has controls to sort, export, rename, or remove its group. Sorting works on ungrouped tabs and leaves existing groups alone. Task sorting first uses saved decisions; without an API key, it also matches distinctive task terms against website names and page titles. With a key, undecided titles can be classified through TypeSafe System One.

## Privacy & development

Tasks, grouping choices, and history stay in Chrome's local storage and IndexedDB. The optional TypeSafe request sends **page titles and task names**, not page URLs or page content. The API key lives in Chrome session storage and clears when the browser session ends. Check exported TXT files before sharing: they contain full page URLs and titles.

This is a local prototype. To inspect task sorting, open Tabnote's **Service worker** at `chrome://extensions` and look for `[Tabnote]` logs. Run `node tests/grouping.cjs` and `node tests/tab-transfer.cjs` for local behavior checks. The project does not yet have a public license.
