/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** 打包 APK / 跨域部署时指定后端地址，例如 http://192.168.1.20:5178 */
  readonly VITE_API_BASE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
