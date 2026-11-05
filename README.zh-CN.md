<h1 align="center"><img src="assets/readme-logo.svg" alt="Tabnote 图标" width="30" height="30"> Tabnote</h1>

<p align="center"><strong>让每个标签页都有归属。</strong><br>按网站或任务整理 Chrome 标签页，保留你的手动调整，并将任务相关网页分享为标签页集合。</p>

<p align="center">
  <a href="manifest.json"><img src="https://img.shields.io/badge/v0.19.5-059669?style=flat-square" alt="版本 0.19.5"></a>
  <a href="manifest.json"><img src="https://img.shields.io/badge/Chrome%20109%2B-2563EB?style=flat-square&amp;logo=googlechrome&amp;logoColor=white" alt="Chrome 109 或更新版本"></a>
  <a href="manifest.json"><img src="https://img.shields.io/badge/Manifest%20V3-7C3AED?style=flat-square" alt="Manifest V3"></a>
</p>

<p align="center">
  <a href="README.md">English</a> ·
  <a href="README.zh-CN.md"><strong>简体中文</strong></a>
</p>

<p align="center">
  <a href="https://github.com/AaronStone1683/TabNote/releases/download/v0.19.5/tabnote-v0.19.5.zip"><strong>⬇ 下载 Tabnote v0.19.5（.zip）</strong></a>
</p>

<p align="center">
  <a href="#快速开始">快速开始</a> ·
  <a href="#功能一览">功能一览</a> ·
  <a href="#分享标签页集合">分享标签页集合</a> ·
  <a href="#隐私">隐私</a>
</p>

弹窗将 **Sites（网站）** 和自动分组开关放在 **Tasks（任务）** 上方。每个网站组和任务组都可单独整理、导出、重命名或移除。
工具栏图标保持透明背景，并根据系统的明暗偏好在白色和深色书签之间切换。

## 一个简单的流程

**创建任务 → 手动将网页移入新分组，或点击整理按钮 → 导出这个任务的标签页集合。**

Tabnote 使用 Chrome 原生标签组。它会记住手动移动和已有的任务判断，重新整理时只处理仍需判断的标签页。整理操作会保留现有分组；**Reset** 会取消所有分组。

## 快速开始

Tabnote 目前是一款本地安装的 Chrome 扩展，无需账号，也无需构建。

1. [下载扩展 ZIP](https://github.com/AaronStone1683/TabNote/releases/download/v0.19.5/tabnote-v0.19.5.zip) 并解压，或克隆本仓库。
2. 在 Chrome 109 或更新版本中打开 `chrome://extensions`，开启**开发者模式**。
3. 点击**加载已解压的扩展程序**，选择包含 `manifest.json` 的解压后文件夹。
4. 将 Tabnote 固定到工具栏，并打开弹窗。
5. 打开 Sites 旁的 **Auto group**，立即按网站整理当前标签页，并自动整理后续新标签。新建任务时会立即产生一个 Chrome 标签组；你可以手动移入网页，或设置 TypeSafe API Key 后点击该任务的整理图标。

> [!IMPORTANT]
> 只有对尚未保存结果的标签页进行自动任务分类时，才需要 TypeSafe API Key。按网站分组、活动历史以及标签页集合的导入导出均无需 API Key。

## 功能一览

| 弹窗中的操作 | 结果 |
| --- | --- |
| **Tasks · Add a task...** | 创建命名任务和对应的 Chrome 标签组，组内先放一个临时空白页。手动移入网页或使用整理功能后，首个真实网页进入时会关闭临时页。 |
| **Tab Set** | 上传别人分享的任务或网站 TXT 文件，并在分组中打开其中的网页。上传入口位于任务输入框旁。 |
| **Sites · Auto group** | 默认关闭。打开后会先整理已打开窗口中符合条件的标签页，再自动按网站整理新标签。新建网站组至少需要两个同站标签页；分组颜色会变化。 |
| **网站行操作** | 整理该网站剩余的标签页、将已打开网页导出为 TXT、重命名网站组，或移除插件自动放入该组的标签页。 |
| **任务行整理图标** | 使用 TypeSafe System One 比较组外标签页的标题和该任务，并将符合条件的网页放入任务组。 |
| **任务行删除图标** | 删除任务并取消该任务组内所有标签页的分组。网页仍保持打开；未使用的临时空白页会关闭。 |
| **Reset** | 取消所有 Chrome 标签组，包括安装 Tabnote 前创建的分组，并暂停自动按网站整理。真实网页保持打开，任务临时页会关闭。 |
| **History** | 下载记录标签页新增和关闭操作的 TXT 文件，包含时间戳与标签页信息。 |

开启网站自动分组后，Tabnote 也会整理符合条件的新标签或已更新的标签。若自动分组的网页跳转到其他网站，它会离开旧的网站组，并可能加入新网站的分组。你手动放进分组的标签页会留在原处。任务分类只在点击对应任务的整理图标时执行，手动给任务分组无需 API Key；已在其他组的标签页不会被重新分类。

任务判断按网页标题和任务保存；再次遇到相同判断时会使用历史结果，而不重复调用 API。匹配阈值为 **0.50**，不确定的网页留在组外。手动将网页移入任务组也会记录你的选择，供之后整理时使用。

弹窗的 **Sites** 列表展示网站图标，并用域名倒数第二段作为短名称；Chrome 中新建的网站组也使用这个名称。任务行会优先使用组内第一个网页的网站图标。你在 Chrome 中手动修改分组名称或颜色后，Tabnote 仍可识别该组。Chrome 原生标签组的标题不支持图片图标。

## 分享标签页集合

点击**任务行的下载图标**，即可导出各 Chrome 窗口中该任务组当前打开的网页。TXT 包含任务名称，以及每个标签页的标题和 URL：

```text
Tabnote Task Group v1
Task: "Review paper"
Tabs:
{"title":"Conference guidelines","url":"https://example.org/guidelines"}
{"title":"Related work","url":"https://example.org/paper"}
```

把文件发给其他 Tabnote 用户后，对方点击任务输入框旁的 **Tab Set**，即可打开这些网页并创建或复用同名任务组。文件在本地读取，导入无需 API Key；每个文件最多支持 500 个 HTTP(S) 网页。

网站组也能从对应行导出。网站 TXT 包含域名、分组名称和标签页；导入时会创建或复用网站组。移除网站组时，手动放入的标签页仍留在原组中。删除任务则会取消该任务组所有标签页的分组，但保留网页。**Reset** 会取消所有 Chrome 标签组，包括安装 Tabnote 前已有的分组和包含手动移动标签页的分组。

> [!NOTE]
> 分享 TXT 前请检查内容：网页标题和完整 URL 可能包含私人信息。**History** 导出的 TXT 格式不同，不能作为标签页集合上传。

## 隐私

| 数据 | 存储位置或发送目标 |
| --- | --- |
| 任务、网站自动整理设置和分组标识 | 本机的 Chrome 本地存储 |
| 已保存的任务判断、手动移动记录和标签页活动 | 本机的 IndexedDB |
| TypeSafe API Key | Chrome 会话存储；浏览器会话结束后清除 |
| 新的自动任务分类请求 | 仅将网页**标题**和**任务名称**发送给 TypeSafe System One |
| 导出的 TXT | 下载到你的设备 |

Tabnote 不会将网页 URL 或内容发送给 TypeSafe。按网站分组和活动记录在本地进行。活动记录从扩展安装时开始；导出历史不会清空记录。

## 排查问题

需要查看任务分类详情时，打开 `chrome://extensions`，找到 Tabnote 并检查其 **Service worker**。以 `[Tabnote]` 开头的日志会显示 API 请求、已保存的判断、分数和错误。固定的标签页、已经在分组中的标签页、浏览器内部页面以及尚未加载完成的网页不会被自动分类。

修改本地扩展文件后，请在 `chrome://extensions` 中点击 Tabnote 卡片上的**重新加载**。

如果你克隆了仓库，可以运行 `node tests/grouping.cjs` 和 `node tests/tab-transfer.cjs` 进行本地行为检查。

## 项目状态

Tabnote 目前是本地原型，尚未添加公开许可证。若要将源码作为开源项目发布，还需要确定并添加许可证。
