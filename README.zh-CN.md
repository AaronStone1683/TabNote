<h1 align="center"><img src="assets/readme-logo.svg" alt="Tabnote 图标" width="30" height="30"> Tabnote</h1>

<p align="center"><strong>让每个标签页都有归属。</strong><br>一个开关整理网站，一个按钮收拢任务，一个文件找回整组网页。</p>

<p align="center">
  <a href="manifest.json"><img src="https://img.shields.io/badge/v0.19.8-059669?style=flat-square" alt="版本 0.19.8"></a>
  <a href="manifest.json"><img src="https://img.shields.io/badge/Chrome%20109%2B-2563EB?style=flat-square&amp;logo=googlechrome&amp;logoColor=white" alt="Chrome 109 或更新版本"></a>
  <a href="manifest.json"><img src="https://img.shields.io/badge/Manifest%20V3-7C3AED?style=flat-square" alt="Manifest V3"></a>
</p>

<p align="center"><a href="README.md">English</a> · <a href="README.zh-CN.md"><strong>简体中文</strong></a></p>
<p align="center"><a href="https://github.com/AaronStone1683/TabNote/releases/download/v0.19.8/tabnote-v0.19.8.zip"><strong>⬇ 下载 Tabnote Chrome 插件</strong></a></p>

## 功能

### 按网站分组

打开 **Auto group**，同一网站的标签页就会进入 Chrome 原生分组；之后打开的新标签页也会继续整理。

https://github.com/user-attachments/assets/1e0fde4d-4111-41aa-a966-eccc68d3d9f2

### 按任务分组

创建任务，点击整理按钮，相关网页就会归到一起。没有 API Key 时，Tabnote 使用历史判断和本地关键词匹配；在钥匙按钮中填写 **TypeSafe API Key** 后，System One 的 Jev 模型会判断尚未分类的网页标题，并保存结果供下次复用。

> [!TIP]
> 知道某个标签页属于哪个任务时，可以直接手动移入分组。Tabnote 会记住你的选择，之后整理也不会把它挪走。

https://github.com/user-attachments/assets/c861dc11-de02-4900-985a-b81a5c2fd67f

### 保存并恢复标签页集合

将任务中的网页导出为 **Tab Set**。分享这个 TXT 文件，或以后重新导入，就能打开网页并恢复分组。

https://github.com/user-attachments/assets/2e313bda-b7a9-4473-ba92-71368c3aa4fd

### 弹窗功能一览

| 入口 | 功能 |
| --- | --- |
| **Sites · Auto group** | 按网站整理已有和新打开的网页；默认关闭。 |
| **Tasks · Add a task** | 立即创建任务组；可手动移动标签页，也可使用整理按钮。 |
| **钥匙按钮** | 填写 TypeSafe API Key，通过 System One 调用 Jev 模型进行任务分类。 |
| **Tab Set** | 导入别人分享的 TXT，在分组中打开保存的网页。 |
| **History** | 导出标签页新增和关闭记录。 |
| **Reset** | 取消所有 Chrome 标签组，保留网页。 |

网站和任务行也可单独整理、导出、重命名或移除。整理会保留已有分组；在 Chrome 中修改分组名称或颜色后，Tabnote 仍能识别它。

## 安装

1. [下载 ZIP](https://github.com/AaronStone1683/TabNote/releases/download/v0.19.8/tabnote-v0.19.8.zip) 并解压。
2. 在 Chrome 109+ 打开 `chrome://extensions`，开启**开发者模式**，点击**加载已解压的扩展程序**。
3. 选择包含 `manifest.json` 的文件夹，将 Tabnote 固定到工具栏并打开。

> [!TIP]
> 网站自动分组默认关闭。在 **Sites** 打开 **Auto group** 后，当前和新打开的标签页都会按网站整理。创建任务和手动移入网页无需 API Key。

## 隐私

任务、分组选择和历史记录保存在本机 Chrome 的本地存储与 IndexedDB。可选的 TypeSafe 请求只发送**网页标题和任务名称**，不发送 URL 或网页内容。API Key 存于 Chrome 会话存储，浏览器会话结束后清除。

> [!IMPORTANT]
> 分享 Tab Set 前请检查内容：导出的 TXT 包含完整 URL 和网页标题。

Tabnote 目前是本地原型，尚未添加公开许可证。需要查看任务分类日志时，可在 `chrome://extensions` 中打开扩展的 **Service worker**；本地检查位于 `tests/`。
