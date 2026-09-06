> 历史开发记录。当前公开测试版以 [Beta 1 验收记录](./Beta1验收记录.md) 和项目 README 为准。

**智慧林业 · Pixel 4 XL 安装记录**

日期：2026-09-06。

| 项目 | 结果 |
|---|---|
| 设备 | Pixel 4 XL，Android 16／API 36 |
| 桌面名称 | 智慧林业 |
| 包名 | cn.zhihuilinye.preview |
| 版本 | 0.1.0-preview，versionCode 10 |
| APK | dist/android/zhihuilinye-0.1.0-preview.apk |
| 签名 | 本机调试签名，v3校验通过 |
| 安装与启动 | adb返回Success；Activity启动成功 |
| 实际布局 | WebView宽411px、高840px，无横向溢出 |
| 操作检查 | 新建表单／取消、示例项目、采集页、Android返回键、任务／设置切换通过 |
| 错误检查 | 本次界面操作未发现JavaScript异常或应用崩溃 |

本包将当前H5产物内置于Android WebView，界面可离线打开。HTTPS资源只从APK资产读取，不回落到网络；已替换框架导航阴影的远程图片，并配置本地图标。

安装过程保留相同包名与本地测试签名，覆盖安装未清除App资料。检查后停留在首页；截图为.preview/pixel4xl-home.png，操作记录为.preview/android-qa.json。最终文件摘要以dist/android/build-info.json为准。

本次没有选择用户相册照片、拍摄照片或在文件选择器中保存CSV；对应原生入口已接入，仍需这些操作的实测。此包用于界面预览，不代替DCloud正式原生运行包或真实识别服务。
