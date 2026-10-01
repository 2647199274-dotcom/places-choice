import type { CapacitorConfig } from '@capacitor/cli';

/**
 * Capacitor 配置：把同一套 Web 前端原样打包成 Android App（P4）。
 *
 * 前置（本机尚未安装，需一次性安装后才能真正出 APK，见 docs/03-Android打包说明.md）：
 *   1. Android Studio（自带 Android SDK + Gradle），或用 sdkmanager 装 command-line tools
 *   2. 设置环境变量 ANDROID_HOME / ANDROID_SDK_ROOT
 *
 * 出包流程：
 *   npm run apk:sync   # 构建前端 + 同步到 android/ 工程
 *   npm run apk:build  # gradle assembleDebug → android/app/build/outputs/apk/debug/app-debug.apk
 *
 * 注意：APK 内页面来自本地文件，没有同源后端可代理，
 *      所以必须在构建时通过 VITE_API_BASE 指定后端地址（手机与电脑同一局域网）。
 */
const config: CapacitorConfig = {
  appId: 'com.triproulette.app',
  appName: '出去玩转盘',
  webDir: 'web/dist',
  bundledWebRuntime: false,
  android: {
    allowMixedContent: true, // 允许 http:// 访问局域网后端（开发期）
  },
  server: {
    // 若手机端想直接连开发机（热重载），临时改成：
    // url: 'http://192.168.x.x:5178', cleartext: true
    androidScheme: 'https',
  },
};

export default config;
