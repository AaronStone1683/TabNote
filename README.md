<h1 align="center"><img src="assets/readme-logo.svg" alt="Tabnote icon" width="30" height="30"> Tabnote</h1>

<p align="center"><strong>Give your tabs a place to belong.</strong><br>One switch for websites. One click for a task. One file to bring the whole set back.</p>

<p align="center">
  <a href="manifest.json"><img src="https://img.shields.io/badge/v0.19.8-059669?style=flat-square" alt="Version 0.19.8"></a>
  <a href="manifest.json"><img src="https://img.shields.io/badge/Chrome%20109%2B-2563EB?style=flat-square&amp;logo=googlechrome&amp;logoColor=white" alt="Chrome 109 or newer"></a>
  <a href="manifest.json"><img src="https://img.shields.io/badge/Manifest%20V3-7C3AED?style=flat-square" alt="Manifest V3"></a>
</p>

<p align="center"><a href="README.md"><strong>English</strong></a> · <a href="README.zh-CN.md">简体中文</a></p>
<p align="center"><a href="https://github.com/AaronStone1683/TabNote/releases/download/v0.19.8/tabnote-v0.19.8.zip"><strong>⬇ Download Tabnote for Chrome</strong></a></p>

## Features

### Group tabs by website

Turn on **Auto group**. Tabs from the same site gather into Chrome's native groups, and new tabs follow as you browse.

https://github.com/user-attachments/assets/1e0fde4d-4111-41aa-a966-eccc68d3d9f2

### Group tabs by task

Create a task, then click its sort button to collect related pages. Without an API key, Tabnote uses saved decisions and local keyword matching. Add a **TypeSafe API key** with the key button to let the Jev model in System One classify undecided page titles; results are saved for next time.

> [!TIP]
> Move a tab into a task group by hand when you know where it belongs. Tabnote remembers your choice and leaves it there during later sorting.

https://github.com/user-attachments/assets/c861dc11-de02-4900-985a-b81a5c2fd67f

### Save and reopen a Tab Set

Export a task's tabs as a **Tab Set**. Share the TXT or import it later to reopen the pages and their group.

https://github.com/user-attachments/assets/2e313bda-b7a9-4473-ba92-71368c3aa4fd

### In the popup

| Control | What it does |
| --- | --- |
| **Sites · Auto group** | Groups open and newly opened pages by website. Off by default. |
| **Tasks · Add a task** | Creates a group immediately. Move tabs into it or use its sort button. |
| **Key button** | Enter a TypeSafe API key to use the Jev model through System One for task classification. |
| **Tab Set** | Imports a shared TXT and opens its saved pages in a group. |
| **History** | Exports a TXT log of added and closed tabs. |
| **Reset** | Removes all Chrome tab groups while keeping your web pages open. |

Site and task rows also let you sort, export, rename, or remove individual groups. Sorting leaves existing groups in place; you can rename or recolor Chrome groups without losing Tabnote's connection.

## Installation

1. [Download the ZIP](https://github.com/AaronStone1683/TabNote/releases/download/v0.19.8/tabnote-v0.19.8.zip) and extract it.
2. In Chrome 109+, open `chrome://extensions`, enable **Developer mode**, and choose **Load unpacked**.
3. Select the folder containing `manifest.json`, then pin and open Tabnote.

> [!TIP]
> Website grouping is off by default. Turn on **Auto group** under **Sites** to sort your open tabs and keep new ones organized. Task groups can be created and filled manually without an API key.

## Privacy

Tasks, grouping choices, and history stay in Chrome's local storage and IndexedDB. Optional TypeSafe requests send **page titles and task names**, not page URLs or page content. The API key lives in Chrome session storage and clears when the browser session ends.

> [!IMPORTANT]
> Check a Tab Set before sharing it: the exported TXT contains full page URLs and titles.

Tabnote is a local prototype and does not yet have a public license. For task sorting logs, inspect its **Service worker** at `chrome://extensions`; local checks are in `tests/`.
