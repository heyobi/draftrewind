import ExpoModulesCore
import Foundation

// iCloud Drive kapsayıcısı (iCloud.com.draftrewind.app) erişimi.
// Yetki (entitlement) yoksa, kullanıcı iCloud'a giriş yapmamışsa ya da iCloud Drive kapalıysa her çağrı
// sessizce "yok" döner (nil / false); asla çökmez. Sunucumuz yok: dosyalar Apple'ın iCloud Drive'ında durur.
public class DraftrewindIcloudModule: Module {
  public func definition() -> ModuleDefinition {
    // JS: requireOptionalNativeModule('DraftrewindIcloud')
    Name("DraftrewindIcloud")

    // Kullanıcı bu cihazda iCloud'a giriş yapmış mı? (hızlı, eşzamanlı)
    Function("icloudAvailable") { () -> Bool in
      return FileManager.default.ubiquityIdentityToken != nil
    }

    // <kapsayıcı>/Documents klasörünün dosya yolu (gerekirse oluşturulur) ya da nil.
    // url(forUbiquityContainerIdentifier:) ana iş parçacığında çağrılmamalı: AsyncFunction modülün
    // kendi kuyruğunda (JS ve ana iş parçacığı dışında) çalışır.
    AsyncFunction("icloudContainerPath") { () -> String? in
      return DraftrewindIcloudModule.containerDocumentsPath()
    }

    // iCloud'daki bir dosyanın indirilmesini başlatır (yer tutucu olabilir). iCloud öğesi değilse
    // dosya yerelde varsa true döner. Hata olursa false.
    AsyncFunction("startDownloading") { (path: String) -> Bool in
      return DraftrewindIcloudModule.startDownloading(path)
    }

    // Dosyanın en güncel hali bu cihazda mı? (iCloud öğesi değilse: dosya var mı)
    AsyncFunction("isDownloaded") { (path: String) -> Bool in
      return DraftrewindIcloudModule.isDownloaded(path)
    }
  }

  // MARK: - Yardımcılar

  private static func containerDocumentsPath() -> String? {
    let fm = FileManager.default
    guard fm.ubiquityIdentityToken != nil else {
      return nil
    }
    guard let base = fm.url(forUbiquityContainerIdentifier: nil) else {
      return nil
    }
    let docs = base.appendingPathComponent("Documents", isDirectory: true)
    var isDir: ObjCBool = false
    if fm.fileExists(atPath: docs.path, isDirectory: &isDir) {
      return isDir.boolValue ? docs.path : nil
    }
    do {
      try fm.createDirectory(at: docs, withIntermediateDirectories: true, attributes: nil)
    } catch {
      return nil
    }
    return docs.path
  }

  private static func isUbiquitous(_ url: URL) -> Bool {
    guard let values = try? url.resourceValues(forKeys: [.isUbiquitousItemKey]) else {
      return false
    }
    return values.isUbiquitousItem == true
  }

  private static func startDownloading(_ path: String) -> Bool {
    if path.isEmpty {
      return false
    }
    let url = URL(fileURLWithPath: path)
    let fm = FileManager.default
    if !isUbiquitous(url) {
      // Eski iOS'ta indirilmemiş öğe ".ad.icloud" yer tutucusu olarak durur; gerçek yol yoktur ama
      // indirme yine de gerçek URL ile istenir. Yerel (iCloud dışı) dosya: var olması yeterli.
      if fm.fileExists(atPath: path) {
        return true
      }
    }
    do {
      try fm.startDownloadingUbiquitousItem(at: url)
      return true
    } catch {
      return false
    }
  }

  private static func isDownloaded(_ path: String) -> Bool {
    if path.isEmpty {
      return false
    }
    let url = URL(fileURLWithPath: path)
    let keys: Set<URLResourceKey> = [.isUbiquitousItemKey, .ubiquitousItemDownloadingStatusKey]
    guard let values = try? url.resourceValues(forKeys: keys) else {
      return false
    }
    if values.isUbiquitousItem != true {
      return FileManager.default.fileExists(atPath: path)
    }
    guard let status = values.ubiquitousItemDownloadingStatus else {
      return false
    }
    return status == .current
  }
}
