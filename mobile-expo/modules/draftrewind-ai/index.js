// JS entry of the local "DraftrewindAi" Expo module (on-device Apple Intelligence, iOS 26+).
// requireOptionalNativeModule returns null when the native side is missing (Expo Go, Android,
// web, an older build), so every function here degrades gracefully instead of throwing on import.
import { requireOptionalNativeModule } from 'expo';

let Native = null;
try {
  Native = requireOptionalNativeModule('DraftrewindAi');
} catch (e) {
  Native = null;
}

// The on-device context window is ~4K tokens (prompt + answer); keep inputs well below it.
export const MAX_PROMPT_CHARS = 6000;
export const MAX_INSTRUCTIONS_CHARS = 1500;

export const STATUSES = ['available', 'deviceNotEligible', 'notEnabled', 'notReady', 'unsupported'];

export const isNativeModuleLoaded = () => !!Native;

// Cuts text to at most `max` characters, preferring a paragraph/sentence/word boundary.
export function truncate(text, max = MAX_PROMPT_CHARS) {
  const s = String(text == null ? '' : text);
  if (s.length <= max) return s;
  const cut = s.slice(0, max);
  const at = Math.max(cut.lastIndexOf('\n'), cut.lastIndexOf('. '), cut.lastIndexOf(' '));
  return (at > max * 0.8 ? cut.slice(0, at) : cut).trimEnd() + ' …';
}

// 'available' | 'deviceNotEligible' | 'notEnabled' | 'notReady' | 'unsupported' — never rejects.
export async function availability() {
  if (!Native || typeof Native.availability !== 'function') return 'unsupported';
  try {
    const status = await Native.availability();
    return STATUSES.includes(status) ? status : 'unsupported';
  } catch (e) {
    return 'unsupported';
  }
}

// Whether the model supports a language code such as 'tr' or 'en' — never rejects.
export async function supportsLanguage(code) {
  if (!Native || typeof Native.supportsLanguage !== 'function') return false;
  try {
    return !!(await Native.supportsLanguage(String(code)));
  } catch (e) {
    return false;
  }
}

function aiError(code, message) {
  const e = new Error(message);
  e.code = code;
  return e;
}

// Generates text on device. Rejects with an Error whose `code` is one of:
// ERR_AI_UNSUPPORTED, ERR_AI_UNAVAILABLE, ERR_AI_NOT_READY, ERR_AI_CONTEXT_WINDOW,
// ERR_AI_GUARDRAIL, ERR_AI_UNSUPPORTED_LANGUAGE, ERR_AI_BUSY, ERR_AI_EMPTY, ERR_AI_FAILED.
export async function generate(instructions, prompt) {
  if (!Native || typeof Native.generate !== 'function') {
    throw aiError('ERR_AI_UNSUPPORTED', 'Apple Intelligence is not available in this build.');
  }
  let out;
  try {
    out = await Native.generate(truncate(instructions, MAX_INSTRUCTIONS_CHARS), truncate(prompt, MAX_PROMPT_CHARS));
  } catch (e) {
    const code = e && typeof e.code === 'string' && e.code.startsWith('ERR_AI_') ? e.code : 'ERR_AI_FAILED';
    throw aiError(code, (e && e.message) || 'Generation failed');
  }
  const text = typeof out === 'string' ? out.trim() : '';
  if (!text) throw aiError('ERR_AI_EMPTY', 'The model returned an empty answer.');
  return text;
}

export default { availability, supportsLanguage, generate, truncate, isNativeModuleLoaded, MAX_PROMPT_CHARS };

// true when the App Group used by the widget extension is reachable (false on most sideloaded
// installs, where re-signing renames the group). Unknown (no native module) → false.
export function appGroupReady(identifier) {
  if (!Native || typeof Native.appGroupReady !== 'function') return false;
  try {
    return !!Native.appGroupReady(identifier);
  } catch (e) {
    return false;
  }
}
