/** Vite-compatible import.meta.env for ui-office components. */
interface ImportMetaEnv {
  readonly DEV: boolean;
  readonly PROD: boolean;
  readonly MODE: string;
  readonly VITE_PLATFORM_API_URL?: string;
  readonly VITE_MINIMAX_API_KEY?: string;
  readonly VITE_MINIMAX_BASE_URL?: string;
  readonly VITE_MINIMAX_MODEL?: string;
  [key: string]: string | boolean | undefined;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
