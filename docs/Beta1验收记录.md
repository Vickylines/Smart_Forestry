# v0.3.0-beta.1 验收记录 / Validation

本文件记录首轮公开测试版的实际验证边界。旧版本文档中的示例功能和自定义服务地址不适用于本版。

## 已完成 / Completed

| 范围 / Area | 验证 / Verification |
| --- | --- |
| 领域逻辑 / Domain | 12 项测试：项目、同株分组、逐图结果、复核历史、CSV 注入防护、ZIP 独立读取、旧示例迁移、项目删除隔离与识别运行保护 |
| 浏览器 / Browser | 新装空状态、键盘与校验、图片持久化、人工复核、CSV、设置资料入口、删除取消与存储失败保护、删除照片和任务、刷新后状态 |
| 布局 / Layout | 320、390、1100px 宽度与 200% 字号检查；无横向溢出。主要页面截图逐页检查 |
| 模拟百度桥接 / Mock Baidu bridge | 密钥输入、缺少 Secret Key、保存后清空、验证、移除与取消；同株两图、第二图失败、重启继续跳过成功图片；保留人工复核；空学名候选可独立选择 |
| 真机密钥 / Device credentials | Pixel 4 XL / Android 16：新测试包无凭据；AES-GCM 密文存储，偏好文件和 Web Storage 不含测试明文；重启仍可使用；移除后重启保持未设置 |
| 真机鉴权 / Native authentication | 使用明确无效的测试凭据访问百度鉴权接口，正确显示 API Key 未被接受。没有使用用户真实密钥或发送照片进行计费识别 |
| 真机相机 / Native camera | Android 11+ 隐式拍摄入口无匹配时，发现并显式调用可用相机；完成拍摄、返回采集页、保存照片、刷新后读取通过 |
| 真机导出 / Native export | 系统文件保存器实际生成 ZIP；独立 ZIP 读取器验证目录、CSV、JSON 和原图字节数 |
| 发布包 / Distribution | APK 归档与签名验证通过；Manifest 确认 debugging、backup、cleartext 均关闭。已覆盖安装到原包名，run-as 确认不可调试；发布文件不含凭据、测试密钥、示例插图或源码映射 |

真实照片与设备测试输出仅保留在本地 `.preview` 中，不随源码或 APK 发布。`-Inspection` 使用独立 `.qa` 包名，分发包关闭调试。

## 发现并修复 / Findings fixed

- 本机资料行原来没有点击处理，改为项目、记录与照片页面。
- 原界面没有项目删除，补上确认、运行中保护及关联资料清理；存储写入失败时不先删除照片。
- 所测 Pixel 的系统隐式 IMAGE_CAPTURE 没有可用处理器，但明确指定所安装相机包可以返回完整照片。现通过系统发现相机，不硬编码品牌。
- 相机启动期间观察到 WebView 渲染进程被回收。现处理 renderer loss，并通过私有待拍摄状态和受限制的图片地址恢复照片；已保存资料不依赖未保存的表单状态。
- 密钥保存后输入组件可能残留旧值，改为清空并重建密码输入控件；离开设置页也清空。
- 多个百度候选的学名为空时，原列表 key 重复，现使用独立 key。
- 旧版示例清理保留真实用户观察及复核，不把真实图片变成演示候选。

## 依赖审计 / Dependency audit

已更新兼容补丁：Vite 5.4.21、Babel、Intlify、ZIP、Express 及解析依赖等，并重新构建 H5、微信小程序和 app-plus 资源。

最终完整 npm audit 报告仍有 **10 个受影响依赖节点：9 moderate、1 high**（不是 10 个彼此独立的漏洞）。根源为 Vite 5 的开发服务器，以及 vue-tsc 间接引入的 Vue 2 模板编译器；其余节点为影响传播。固定 DCloud 编译器与这些版本存在兼容依赖，未用强制跨代升级掩盖报告。

- 开发服务固定回环地址、禁止跨域，并禁用打开编辑器的中间件入口。
- 这些措施不代表开发工具漏洞已经消除；不要对外开放开发服务器或编译不受信任的输入。
- 发布 APK 只含 H5 生产静态资源、原生 Android 代码和图标，不包含 Node、Vite 开发服务器、源码映射、识别凭据或签名私钥。

Remaining findings are in build/type-check/development-server dependencies. Compatibility patches and a loopback-only development boundary have been applied, but the remaining advisories are not considered resolved. The APK contains static production assets and native Android code, not a development server.

## 未覆盖 / Not covered

- 真实植物识别准确率、生产账号成功鉴权及剩余额度；本轮识别结果与断点续传验证使用模拟响应。
- Android 其他机型的完整实测、iOS 或微信真机验收。
- 云同步、账号系统、备份导入、后台持续识别。应用卸载或清除资料后的恢复依赖用户事先导出的文件。

## 依据 / References

- [Android 11 相机 Intent 限制](https://developer.android.com/about/versions/11/behavior-changes-11#media-capture)
- [WebView 调试开关](https://developer.android.com/develop/ui/views/layout/webapps/debug-chrome-devtools)
- [Vite Windows 路径安全公告](https://github.com/advisories/GHSA-fx2h-pf6j-xcff)
- [Vue 模板编译器安全公告](https://github.com/advisories/GHSA-g3ch-rx76-35fx)
