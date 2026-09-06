# Smart Forestry

[简体中文](README.md) · English

An Android app for field plant surveys: create projects, capture photos, identify plants with Baidu, review names, and export records with original photos.

**First public beta: v0.3.0-beta.1.** [Download the APK](https://github.com/Vickylines/Smart_Forestry/releases/tag/v0.3.0-beta.1).

## Getting started

1. Install the APK on Android 10 or later.
2. Open Settings and enter your Baidu **API Key** and **Secret Key**, then tap Save.
3. Use **Verify key** to check authentication. **Remove key** deletes the saved credentials without deleting survey data.
4. Create a project, take or select photos, and start identification from Tasks. Review the returned names before using them.
5. Export CSV for records, or ZIP for records, photos and review history.

The APK contains no identification credentials. Credentials are encrypted with AES-GCM using an Android Keystore key; they are excluded from exports and app backups. Photos are uploaded to Baidu only when an identification task is submitted. Identification requires internet access and the appropriate Baidu service permissions/quota. The authentication check does not verify remaining quota. No live plant-identification accuracy benchmark was performed for this release.

The app starts without sample data. Upgrades remove old examples while keeping actual observations added to an example project. Settings opens local projects, observations and photos. Project deletion requires confirmation and removes its records, tasks and local photos.

## Build and test

The client uses uni-app, Vue 3 and TypeScript. The Android package bundles the H5 production output in a WebView, with native camera, Android Keystore and system file export bridges. The app UI is currently in Chinese.

Requires Node.js 22.18+; Android builds additionally require JDK 17, Android SDK platform 36 and build tools 36.0.0.

```powershell
cd apps/client
npm ci
npm run type-check
npm test
npm run build:h5
npm run dev:h5
```

In a second terminal, set `APP_URL` to the preview URL and run `npm run test:browser` and `npm run test:integration`. Integration tests use simulated Baidu bridge responses and do not consume provider quota.

```powershell
./apps/android-preview/build.ps1 -JdkPath 'YOUR_JDK17' -SdkPath 'YOUR_ANDROID_SDK'
```

The distribution APK has application/WebView debugging disabled. `-Inspection` builds an isolated `.qa` package for device tests; never distribute that package. Keep the ignored `.android-preview/debug.keystore` private and backed up if you need compatible updates to APKs you build. GitHub release APKs use the maintainer's existing local test signing key. A separately generated key cannot update an installation signed by a different key.

## Scope and limitations

- Local storage only; no accounts, cloud sync, multi-user collaboration, or backup import. Uninstalling or clearing app data deletes local records and the saved credentials. Export a ZIP first.
- Keep the app open during identification. Interrupted tasks can resume and skip completed photos.
- Android is the tested runtime. WeChat/app-plus resource compilation does not constitute device validation for those platforms.
- The dependency audit still reports findings in the development compiler/server toolchain. Compatible security updates have been applied; see the [audit record](docs/Beta1验收记录.md). No development server is bundled in the APK. Do not expose the development server or use it to open untrusted projects.

See the [bilingual release notes](docs/releases/v0.3.0-beta.1.md) and [validation record](docs/Beta1验收记录.md). Report issues with the app version, Android/device version, steps, and expected/actual results. Do not include keys or private photos.
