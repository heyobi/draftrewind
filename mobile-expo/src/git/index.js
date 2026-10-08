// Telefonun git motorunun genel arayüzü (aşama 1a: yalnızca motor; ekranlara henüz bağlı değil).
import './polyfill.js';

export {
  gitEngineVersion,
  openProject,
  importLocalLog,
  GitProject,
  parseMessage,
  buildCommitMessage,
  ignoredPath,
  defaultT,
  BRANCH,
  TRAILER,
  MAX_FILE_BYTES,
} from './engine.js';
export { createFs } from './fsAdapter.js';
export { http, makeHttp, onAuth } from './http.js';
export { libraryGitRootUri, containerUriFromDocuments, uriToPath, pathToUri, projectGitdir } from './paths.js';
export { backendExpo, ensureGitRoot, documentsPath } from './backendExpo.js';
