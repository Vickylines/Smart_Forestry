**智慧林业 Android 测试包 / Android beta**

本目录将客户端 H5 生产资源内置到 Android WebView，并提供相机、百度识图凭据加密和系统文件导出。当前版本为 0.3.0-beta.2，最低 Android 10，包名 cn.zhihuilinye.preview。

~~~powershell
./build.ps1 -JdkPath '你的JDK17目录' -SdkPath '你的AndroidSDK目录'
~~~

构建需要 SDK platform 36、build tools 36.0.0。输出到 dist/android/zhihuilinye-0.3.0-beta.2.apk，默认关闭应用与 WebView 调试。Windows 构建使用 LOCALAPPDATA/CodexAndroidBuilds 下的 ASCII 暂存路径。

- APK 不包含识别账号或密钥；用户在设置输入 API Key 和 Secret Key，凭据由 Android Keystore 与 AES-GCM 加密保存。
- 相机仅通过系统授权的内容 URI 返回照片，不要求整个相册的读取权限。待拍摄信息用于进程恢复，成功保存后移除临时拍摄文件。
- CSV 和 ZIP 通过系统文件保存器写入用户选择的位置。
- .android-preview/debug.keystore 为维护者现有本地测试签名，必须私下保留以支持覆盖安装，不能提交仓库。
- 加 -Inspection 得到隔离的 cn.zhihuilinye.preview.qa 包；只用于开发调试，不对外分发。原有应用资料不会被 QA 包读取。

This directory builds the Android beta from production web assets. Distribution builds disable debugging and contain no identification credentials. Use -Inspection for an isolated QA package. Preserve the private local signing key to build compatible updates.

独立 QA 包包含原生鉴权回归入口，可运行 `adb shell am instrument -w cn.zhihuilinye.preview.qa/.BaiduRegression`。该测试替换 HTTPS 连接，检查重复鉴权、失效密钥与重试，不向百度发送请求。测试类只复制到 Inspection 构建；发布检查会拒绝含有测试类或测试凭据的 APK。

完整说明：[中文](../../README.md)、[English](../../README.en.md)、[本轮验收](../../docs/Beta2验收记录.md)。
