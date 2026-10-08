// Drive'daki okunabilir dosyalar ile telefondaki proje klasörü arasında çift yönlü dosya eşitlemesi.
// Masaüstündeki drive.reconcile ile aynı kurallar; tek fark: yerel taraf md5 yerine git blob oid'iyle izlenir
// (telefonda md5 hesaplamaya gerek kalmaz). Geçmiş ayrıca .draftrewind paketleriyle taşınır (syncStore);
// bu katman Drive'da / Google Dokümanlar'da elle yapılan düzenlemeleri ve Drive'ı yalnızca klasör olarak
// görenlerin (_Sürümler) ihtiyacını karşılar.
//
// remote: { list() → Map(rel → { md5, size }), read(rel) → Uint8Array, write(rel, bytes) → md5,
//           version(rel, bytes, kind), archive(rel) }
// state (kalıcı): { base: { rel: { oid, md5 } }, versionTimes: { rel: ms } }
// Kural: S = son eşitlenen hal. Yalnız Drive değişti → indir · yalnız telefon değişti → yükle ·
//        ikisi de değişti → hiçbiri ezilmez: Drive'daki hal "<ad> (Drive'dan).<uzantı>" olarak eklenir.
import * as git from 'isomorphic-git';
import { conflictName } from '../wsCore.js';

export const VERSION_EVERY_MS = 30 * 60 * 1000;

const driveCopyName = (rel) => conflictName(rel).replace(' (diğer cihazdan)', " (Drive'dan)");

// opts: { kind, upload (false: yalnızca indir), now }
// Dönen: { uploaded: [rel], downloaded: [rel], conflicts: [rel], archived: [rel], pending: [rel] }
export async function mirror(project, remote, state, { kind = 'auto', upload = true, now = Date.now() } = {}) {
  state.base = state.base || {};
  state.versionTimes = state.versionTimes || {};
  const base = state.base;
  const result = { uploaded: [], downloaded: [], conflicts: [], archived: [], pending: [] };
  const { files: localFiles } = await project.scan();
  const remoteFiles = await remote.list();
  const oidOf = async (bytes) => (await git.hashBlob({ object: bytes })).oid;

  const shouldVersion = (rel) => {
    const last = state.versionTimes[rel] || 0;
    if (kind === 'star' || now - last >= VERSION_EVERY_MS) {
      state.versionTimes[rel] = now;
      return true;
    }
    return false;
  };
  const push = async (rel, L, versioned) => {
    if (!upload) {
      result.pending.push(rel);
      return;
    }
    const bytes = await project.readWorking(rel);
    if (!bytes) return;
    const md5 = await remote.write(rel, bytes);
    base[rel] = { oid: L, md5 };
    if (versioned && shouldVersion(rel)) await remote.version(rel, bytes, kind);
    result.uploaded.push(rel);
  };
  const pull = async (rel, R, target = rel) => {
    const bytes = await remote.read(rel);
    const oid = await oidOf(bytes);
    await project.writeWorking(target, bytes);
    if (target === rel) base[rel] = { oid, md5: R };
    result.downloaded.push(target);
    return oid;
  };

  const all = new Set([...localFiles.keys(), ...remoteFiles.keys()]);
  for (const rel of all) {
    try {
      const L = localFiles.has(rel) ? await project.workingOid(rel) : null;
      if (L === undefined) continue;
      if (L === null && localFiles.has(rel)) continue; // okunamadı (açık/indirilmemiş): bu tur dokunma
      const R = remoteFiles.has(rel) ? remoteFiles.get(rel).md5 : null;
      const S = base[rel];
      if (!L && !R) {
        delete base[rel];
        continue;
      }
      if (L && !R) {
        // Drive'da yok (yeni dosya ya da Drive'dan silinmiş): veri kaybolmasın diye yükle
        await push(rel, L, !!S && S.oid !== L);
        continue;
      }
      if (!L && R) {
        if (S && S.md5 === R) {
          // Telefonda silindi, Drive'da değişmedi → Drive'daki kopya _Sürümler'e taşınır
          if (!upload) {
            result.pending.push(rel);
            continue;
          }
          await remote.archive(rel);
          delete base[rel];
          result.archived.push(rel);
        } else {
          await pull(rel, R);
        }
        continue;
      }
      if (S && S.oid === L && S.md5 === R) continue;
      if (S && S.oid === L) {
        await pull(rel, R); // yalnızca Drive'da değişmiş
        continue;
      }
      if (S && S.md5 === R) {
        await push(rel, L, true); // yalnızca telefonda değişmiş
        continue;
      }
      // İlk karşılaşma ya da iki tarafta da değişmiş: önce içerik aynı mı bak
      const bytes = await remote.read(rel);
      if ((await oidOf(bytes)) === L) {
        base[rel] = { oid: L, md5: R };
        continue;
      }
      const alt = driveCopyName(rel);
      await project.writeWorking(alt, bytes);
      result.downloaded.push(alt);
      result.conflicts.push(alt);
      if (upload) {
        base[alt] = { oid: await oidOf(bytes), md5: await remote.write(alt, bytes) };
      }
      await push(rel, L, true);
    } catch (e) {
      // Bu dosya bu turda atlanır; bir sonraki eşitlemede yeniden denenir
    }
  }
  return result;
}
