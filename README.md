# 智慧林业

[English](README.en.md) · 简体中文

用于植物外业调查的 Android 应用：创建项目、拍摄照片、百度识图、人工复核，以及表格和原图导出。

**当前测试版：v0.3.0-beta.4。** [下载 APK](https://github.com/Vickylines/Smart_Forestry/releases/tag/v0.3.0-beta.4)。

新增全球分类库查询、异名与园艺基础分类匹配，并支持补查旧记录。银杏、洋桔梗已验证；固定 100 名称中 95 个返回完整科属，**尚未达到或验证全球 99% 覆盖**。默认字号保持不变，详见[Beta 4 验收记录](docs/Beta4验收记录.md)。

## 开始使用

1. 在 Android 10 或更高版本安装 APK。
2. 在设置中填写百度 **API Key** 和 **Secret Key**，点击“保存密钥”。
3. “验证密钥”检查鉴权；“移除密钥”清除已保存凭据，保留调查资料。
4. 新建项目，拍照或选择照片，在任务页提交识别，并人工核对名称。
5. 旧记录可在项目页“补查已有记录科属”；已确认记录可在人工复核页补查并保存，原人工结论不会自动覆盖。
6. 导出 CSV 获取表格；导出 ZIP 获取表格、照片和复核记录。

APK 不包含识别密钥。填写的密钥通过 Android Keystore 与 AES-GCM 加密保存，不进入导出包或应用备份。提交识别时才上传照片至百度。科属查询仅将名称发送至 iNaturalist、GBIF 和 Wikidata，不发送照片、位置或密钥，无需额外 API Key。联网识别需要本人账号开通相应服务并具备额度；验证鉴权不等于验证剩余额度。本轮没有进行真实植物照片识别准确率评测。

首次启动无示例数据。升级会移除旧示例，但保留添加在旧示例项目中的真实记录。设置中的项目、观察、照片均可打开；项目删除需确认，并同时删除关联记录、任务及本机照片。

采集照片、备注与分组会保存为本机草稿。重新进入同一项目的“添加观察”可继续，点击“保存观察”后才创建记录与识别任务。导出包含已保存观察；请先提交需要备份的草稿。

## 开发与构建

客户端使用 uni-app、Vue 3、TypeScript。Android 安装包内置 H5 生产资源，通过原生桥接实现相机、密钥库和系统文件导出。目前应用界面为中文。

需要 Node.js 22.18+。构建 APK 另需 JDK 17、Android SDK platform 36、build tools 36.0.0。

~~~powershell
cd apps/client
npm ci
npm run type-check
npm test
npm run build:h5
npm run dev:h5
~~~

另开终端，将 APP_URL 环境变量设为预览地址，再运行 npm run test:browser、npm run test:integration、npm run test:regressions 和 npm run test:taxonomy。识别集成测试使用模拟原生桥接响应，不消耗百度额度。npm run test:taxonomy:live 可单独运行真实分类库的 100 名称固定样本测量；结果输出到 .preview/beta4/taxonomy-live.json，不自动作为全球覆盖或准确率声明。

~~~powershell
./apps/android-preview/build.ps1 -JdkPath '你的JDK17目录' -SdkPath '你的AndroidSDK目录'
~~~

发布包关闭应用和 WebView 调试。加 -Inspection 构建独立 .qa 包供真机检查，该包不可对外分发。自行构建时请妥善备份被忽略的 .android-preview/debug.keystore，以便后续覆盖安装；GitHub 发布包沿用维护者现有本地测试签名。不同签名的 APK 不能直接覆盖安装。

## 测试版范围

- 资料仅保存在本机。暂无账号、云同步、多人协作或备份导入；卸载或清除应用数据会删除资料与密钥，请先导出 ZIP。
- 识别时保持应用打开；中断后可继续，跳过已完成照片。
- 已验证运行平台为 Android；微信和 app-plus 资源编译不代表对应平台已经实机验收。
- 开发编译工具仍有依赖审计告警；已更新兼容的安全补丁，详情见[验收记录](docs/Beta1验收记录.md)。APK 不包含开发服务器。开发服务不可对公网开放，也不要用于打开不受信任的项目。

详见[中英文发布说明](docs/releases/v0.3.0-beta.4.md)和[本轮验收记录](docs/Beta4验收记录.md)。反馈问题时请说明应用版本、机型与系统、复现步骤及预期／实际结果；不要附带密钥或私人照片。
