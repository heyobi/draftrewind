import ExpoModulesCore
import StoreKit

// DraftRewind Pro: a single non-consumable bought once with StoreKit 2.
// The purchase is verified by StoreKit on the device; there is no server of ours.
public class DraftrewindStoreModule: Module {
  private var updates: Task<Void, Never>?

  public func definition() -> ModuleDefinition {
    // Accessible from JS via requireOptionalNativeModule('DraftrewindStore')
    Name("DraftrewindStore")

    // Purchases that finish outside the app's purchase call (Ask to Buy approval, a purchase on
    // another device, a refund) arrive here; they are finished so StoreKit stops redelivering them.
    OnCreate {
      self.updates = Task.detached {
        for await result in Transaction.updates {
          if case .verified(let transaction) = result {
            await transaction.finish()
          }
        }
      }
    }

    OnDestroy {
      self.updates?.cancel()
    }

    // { id, displayName, displayPrice } or an empty object when the product cannot be loaded
    // (not set up in App Store Connect yet, no network, or a sideloaded build).
    AsyncFunction("product") { (id: String) async throws -> [String: String] in
      guard let product = try await Product.products(for: [id]).first else {
        return [:]
      }
      return ["id": product.id, "displayName": product.displayName, "displayPrice": product.displayPrice]
    }

    // 'purchased' | 'cancelled' | 'pending' | 'unverified' | 'unavailable'
    AsyncFunction("purchase") { (id: String) async throws -> String in
      guard let product = try await Product.products(for: [id]).first else {
        return "unavailable"
      }
      let result = try await product.purchase()
      switch result {
      case .success(let verification):
        switch verification {
        case .verified(let transaction):
          await transaction.finish()
          return "purchased"
        case .unverified(let transaction, _):
          await transaction.finish()
          return "unverified"
        }
      case .userCancelled:
        return "cancelled"
      case .pending:
        return "pending"
      @unknown default:
        return "cancelled"
      }
    }

    // true when this Apple ID owns the product (verified, not refunded).
    AsyncFunction("isEntitled") { (id: String) async -> Bool in
      return await DraftrewindStoreModule.owns(id)
    }

    // "Restore purchases": asks the App Store to resync (may show the Apple ID sign-in), then checks again.
    AsyncFunction("restore") { (id: String) async throws -> Bool in
      try await AppStore.sync()
      return await DraftrewindStoreModule.owns(id)
    }
  }

  private static func owns(_ id: String) async -> Bool {
    for await result in Transaction.currentEntitlements {
      if case .verified(let transaction) = result, transaction.productID == id, transaction.revocationDate == nil {
        return true
      }
    }
    return false
  }
}
