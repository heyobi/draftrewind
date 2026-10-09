import CryptoKit
import ExpoModulesCore
import Foundation

// Git motorunun ağır hesapları (SHA-1 özeti, zlib sıkıştırma/açma) yerel kodda ve arka plan kuyruğunda:
// JS iş parçacığı (dokunmatik ve çizim de orada) beklemez. Biçimler git'in beklediğiyle birebir aynı:
//   deflate → zlib akışı (RFC 1950: 2 bayt başlık + ham DEFLATE + Adler-32)
//   inflate → zlib akışı girer, ham veri çıkar
public class DraftrewindGitModule: Module {
  public func definition() -> ModuleDefinition {
    Name("DraftrewindGit")

    AsyncFunction("sha1") { (data: Data) -> String in
      let digest = Insecure.SHA1.hash(data: data)
      return digest.map { String(format: "%02x", $0) }.joined()
    }

    AsyncFunction("deflate") { (data: Data) throws -> Data in
      return try DraftrewindGitModule.zlibDeflate(data)
    }

    AsyncFunction("inflate") { (data: Data) throws -> Data in
      return try DraftrewindGitModule.zlibInflate(data)
    }
  }

  static func zlibDeflate(_ data: Data) throws -> Data {
    // NSData.compressed(using: .zlib) ham DEFLATE üretir (başlık ve sağlama yok)
    let raw = try (data as NSData).compressed(using: .zlib) as Data
    var out = Data(capacity: raw.count + 6)
    out.append(contentsOf: [0x78, 0x9c])
    out.append(raw)
    var adler = adler32(data).bigEndian
    withUnsafeBytes(of: &adler) { out.append(contentsOf: $0) }
    return out
  }

  static func zlibInflate(_ data: Data) throws -> Data {
    guard data.count >= 2 else { return Data() }
    // zlib başlığı (CMF/FLG) atlanır; FDICT kullanılmaz (git kullanmaz). Sondaki Adler-32'yi açıcı yok sayar.
    let cmf = data[data.startIndex]
    // Başlık (2 bayt) ve sondaki Adler-32 (4 bayt) atılır: açıcıya yalnızca ham DEFLATE verilir
    let body = (cmf & 0x0f) == 8 && data.count > 6 ? data.subdata(in: (data.startIndex + 2)..<(data.endIndex - 4)) : data
    return try (body as NSData).decompressed(using: .zlib) as Data
  }

  static func adler32(_ data: Data) -> UInt32 {
    var a: UInt32 = 1
    var b: UInt32 = 0
    let mod: UInt32 = 65521
    data.withUnsafeBytes { (buf: UnsafeRawBufferPointer) in
      var i = 0
      let n = buf.count
      while i < n {
        // 5552 bayta kadar taşma olmadan toplanabilir
        let end = min(i + 5552, n)
        while i < end {
          a &+= UInt32(buf[i])
          b &+= a
          i += 1
        }
        a %= mod
        b %= mod
      }
    }
    return (b << 16) | a
  }
}
