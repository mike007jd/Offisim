// Side-effect module: register the adapters-mock loader. Imported FIRST by the
// harness (before any module that transitively pulls `data/adapters.js`) so the
// loader is active by the time the renderer data layer resolves. ESM evaluates
// imports in source order, and this module's body runs to completion before the
// next import is evaluated.
import { register } from 'node:module';
import { pathToFileURL } from 'node:url';

register('./harness-chat-persistence.loader.mjs', pathToFileURL(import.meta.filename));
