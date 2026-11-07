<h1 align="center"><img src="assets/readme-logo.svg" alt="Tabnote 图标" width="30" height="30"> Tabnote</h1>

<p align="center"><strong>让每个标签页都有归属。</strong><br>一个开关整理网站，一个按钮收拢任务，一个文件找回整组网页。</p>

<p align="center">
  <a href="manifest.json"><img src="https://img.shields.io/badge/v0.19.8-059669?style=flat-square" alt="版本 0.19.8"></a>
  <a href="manifest.json"><img src="https://img.shields.io/badge/Chrome%20109%2B-2563EB?style=flat-square&amp;logo=googlechrome&amp;logoColor=white" alt="Chrome 109 或更新版本"></a>
  <a href="manifest.json"><img src="https://img.shields.io/badge/Manifest%20V3-7C3AED?style=flat-square" alt="Manifest V3"></a>
</p>

<p align="center"><a href="README.md">English</a> · <a href="README.zh-CN.md"><strong>简体中文</strong></a></p>
<p align="center"><a href="https://github.com/AaronStone1683/TabNote/releases/download/v0.19.8/tabnote-v0.19.8.zip"><strong>⬇ 下载 Tabnote Chrome 插件</strong></a></p>

## 看标签页自己归位

打开 **Auto group**，同一网站的标签页就会进入 Chrome 原生分组；之后打开的新标签页也会继续整理。

https://github.com/user-attachments/assets/1e0fde4d-4111-41aa-a966-eccc68d3d9f2

### 给任务留一个空间

创建任务，点击整理按钮，相关网页就会归到一起。你也可以随时手动移动标签页，以自己的判断为准。

https://github.com/user-attachments/assets/c861dc11-de02-4900-985a-b81a5c2fd67f

### 一键找回整组网页

将任务中的网页导出为 **Tab Set**。分享这个 TXT 文件，或以后重新导入，就能打开网页并恢复分组。

https://github.com/user-attachments/assets/2e313bda-b7a9-4473-ba92-71368c3aa4fd

## 顺着你的浏览习惯来

- **手动调整优先。** 你亲手放进分组的标签页，不会被自动整理挪走。
- **记住已有判断。** 任务分类会复用历史结果；Tab Set 则能让别人打开同一组网页。
- **使用 Chrome 原生分组。** 修改分组名称或颜色后，Tabnote 仍能识别它。
- **无需先配置 API。** 网站分组和本地任务匹配开箱可用；TypeSafe System One 只是可选的任务分类方式。

## 立即试用

1. [下载 ZIP](https://github.com/AaronStone1683/TabNote/releases/download/v0.19.8/tabnote-v0.19.8.zip) 并解压。
2. 在 Chrome 109+ 打开 `chrome://extensions`，开启**开发者模式**，点击**加载已解压的扩展程序**。
3. 选择包含 `manifest.json` 的文件夹，将 Tabnote 固定到工具栏并打开。
4. 在 **Sites** 打开 **Auto group**，或新建 **Task** 后点击整理按钮。

| 弹窗入口 | 功能 |
| --- | --- |
| **Sites · Auto group** | 按网站整理已有和新打开的网页；默认关闭。 |
| **Tasks · Add a task** | 立即创建任务组；可手动移动标签页，也可使用整理按钮。 |
| **Tab Set** | 导入别人分享的 TXT，在分组中打开保存的网页。 |
| **History** | 导出标签页新增和关闭记录。 |
| **Reset** | 取消所有 Chrome 标签组，保留网页。 |

网站和任务行也可单独整理、导出、重命名或移除。整理只处理组外标签页，已有分组不受影响。任务分类先复用历史判断；没有 API Key 时，还会用任务关键词匹配网站名称和网页标题；有 Key 时，可将尚未判断的标题交给 TypeSafe System One。

## 隐私与开发

任务、分组选择和历史记录保存在本机 Chrome 的本地存储与 IndexedDB。可选的 TypeSafe 请求只发送**网页标题和任务名称**，不发送 URL 或网页内容。API Key 存于 Chrome 会话存储，浏览器会话结束后清除。分享导出的 TXT 前请检查：其中包含完整 URL 和网页标题。

Tabnote 目前是本地原型。需要查看分类日志时，在 `chrome://extensions` 中打开 Tabnote 的 **Service worker**，搜索 `[Tabnote]`。本地行为检查可运行 `node tests/grouping.cjs` 和 `node tests/tab-transfer.cjs`。项目尚未添加公开许可证。
