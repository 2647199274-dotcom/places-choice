# Android APK 打包说明（P4）

目标：把同一套 Web 前端（`web/`）原样打包成手机 App，不用重写一套原生代码。

## 一、当前状态（已实测）

| 项目 | 状态 |
|---|---|
| Capacitor 依赖（`@capacitor/core` / `cli` / `android`） | ✅ 已安装，`npx cap --version` → 7.6.9 |
| `capacitor.config.ts` | ✅ 已就绪（appId `com.triproulette.app`，webDir `web/dist`） |
| 前端 API 地址可配置（`VITE_API_BASE`） | ✅ 已实现并已通过浏览器验证 |
| JDK | ✅ 已装 Java 21（AGP 8.x 要求 ≥17，满足） |
| **Android SDK** | ❌ **未安装**（无 `ANDROID_HOME`，无 `%LOCALAPPDATA%\Android\Sdk`） |
| **Gradle** | ❌ 未安装（`gradlew` 由 `cap add android` 生成包装器后自带，不需要全局 gradle） |
| Android Studio | ❌ 未安装 |

**结论：本机现在无法直接产出 APK，缺的只有 Android SDK（约 1–2 GB 下载）。** 装好后一条命令即可出包。

> 补充：本会话的沙箱禁止启动子进程（spawn EPERM），Gradle 构建必须启动 JVM/子进程，
> 所以即使装好 SDK，也请**在普通终端里**执行打包命令，不要在受限沙箱里跑。

## 二、安装 Android SDK（二选一，约 10 分钟）

### 方案 A：装 Android Studio（最省事，推荐）

1. 下载安装 [Android Studio](https://developer.android.com/studio)
2. 首次启动向导里勾选 **Android SDK**、**Android SDK Platform-Tools**、**Android SDK Build-Tools**
3. 装完在 Android Studio 里 `More Actions → SDK Manager`，确认已装 **Android 15 (API 35)** 或更高平台
4. 设置环境变量（PowerShell，管理员）：
   ```powershell
   setx ANDROID_HOME "$env:LOCALAPPDATA\Android\Sdk"
   setx ANDROID_SDK_ROOT "$env:LOCALAPPDATA\Android\Sdk"
   ```

### 方案 B：只装命令行工具（体积小）

1. 下载 [commandlinetools-win](https://developer.android.com/studio#command-tools)，解压到 `C:\Android\Sdk\cmdline-tools\latest`
2. 安装组件：
   ```powershell
   $env:ANDROID_HOME="C:\Android\Sdk"
   & "$env:ANDROID_HOME\cmdline-tools\latest\bin\sdkmanager.bat" --licenses
   & "$env:ANDROID_HOME\cmdline-tools\latest\bin\sdkmanager.bat" "platform-tools" "platforms;android-35" "build-tools;35.0.0"
   setx ANDROID_HOME "C:\Android\Sdk"
   ```

## 三、出包流程

```powershell
# 0) 先确认后端在跑，并拿到电脑的局域网 IP（手机和电脑要连同一个 Wi-Fi）
npm run api
ipconfig        # 找 IPv4 地址，例如 192.168.1.20

# 1) 生成 android/ 原生工程（只需一次）
npx cap add android

# 2) 构建前端 + 同步进原生工程（注意 API 地址必须是电脑的局域网地址）
$env:VITE_API_BASE="http://192.168.1.20:5178"
npm run apk:sync

# 3) 编译 APK
npm run apk:build
# 产物：android\app\build\outputs\apk\debug\app-debug.apk
```

把 `app-debug.apk` 传到手机安装（需允许"安装未知来源应用"），打开即是转盘 App。

### 温控小技巧（免打包调试）

改 `capacitor.config.ts` 的 `server.url` 指向开发机，App 会直接加载网页，改代码即时生效：

```ts
server: { url: 'http://192.168.1.20:5178', cleartext: true }
```

## 四、为什么 APK 必须指定 `VITE_API_BASE`

浏览器里打开 `http://127.0.0.1:5178/` 时，前端和 API 同源（Fastify 直接托管 `web/dist`），所以 `api.ts` 里留空即可。
但 APK 里的页面来自本地文件（`https://localhost` 或 `capacitor://`），**不存在同源后端**，
因此必须在构建时把后端地址烧进去，否则会请求到手机自己的 localhost 而失败。

### 已经内建的离线兜底

即便 `VITE_API_BASE` 没连上（电脑不在、手机没连 Wi-Fi），App 也不会白屏：

1. 首次联网打开时会把全量数据集存进 `localStorage`
2. 之后网络不可达 → 自动进入**离线模式**（顶部徽标提示），用内置的本地抽签引擎转盘
3. 结果卡、高德链接、「就去这家」的足迹记录在离线状态下同样可用
4. 本地引擎与后端引擎的规则一致性由 `npm run test:local` 校验（逐字段一致）

因此打包时可以不填 `VITE_API_BASE` 先出一个**纯离线版**，一样能抽签（数据为打包前同步到本地的那一份）。

## 五、后续可选增强

- **定位**：接入 `@capacitor/geolocation`，实现"3 公里内随机"。
- **分享**：`@capacitor/share` 分享抽签结果到微信/朋友圈。
- **正式签名**：`keytool` 生成 keystore + `assembleRelease`，产出可上架/分发的正式包。
- **开机同步**：App 启动时后台静默调用 `/api/dataset` 刷新本地缓存（有网就更新，没网就用旧的）。
