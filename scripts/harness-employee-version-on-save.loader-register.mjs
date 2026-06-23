// Side-effect module: register the adapters-mock loader (reused from the
// chat-persistence harness). Imported FIRST by the version-on-save harness so
// the loader is active before `personnel-data.ts` transitively resolves the
// renderer's `data/adapters.js` (whose import chain pulls Tauri-only modules).
import { register } from 'node:module';
import { pathToFileURL } from 'node:url';

register('./harness-chat-persistence.loader.mjs', pathToFileURL(import.meta.filename));
