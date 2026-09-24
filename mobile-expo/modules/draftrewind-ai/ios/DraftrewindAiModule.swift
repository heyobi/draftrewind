import ExpoModulesCore
import Foundation
#if canImport(FoundationModels)
import FoundationModels
#endif

// On-device Apple Intelligence (Foundation Models, iOS 26+).
// Everything runs on the phone; nothing is sent to a server.
// On older iOS versions, or SDKs without FoundationModels, every call degrades to "unsupported".
public class DraftrewindAiModule: Module {
  public func definition() -> ModuleDefinition {
    // Accessible from JS via requireOptionalNativeModule('DraftrewindAi')
    Name("DraftrewindAi")

    // 'available' | 'deviceNotEligible' | 'notEnabled' | 'notReady' | 'unsupported'
    AsyncFunction("availability") { () -> String in
      return DraftrewindAiModule.currentAvailability()
    }

    // true when the on-device model supports the given language code (e.g. "tr", "en").
    AsyncFunction("supportsLanguage") { (code: String) -> Bool in
      return DraftrewindAiModule.supportsLanguage(code)
    }

    // true when this build can really open the given App Group container. Sideloading tools
    // (free Apple ID) rename App Groups when re-signing; the widget extension then cannot read
    // the Live Activity layout and the Dynamic Island shows an empty black pill.
    Function("appGroupReady") { (identifier: String) -> Bool in
      return FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: identifier) != nil
    }

    // Runs a single prompt in a fresh session and resolves with the generated text.
    AsyncFunction("generate") { (instructions: String, prompt: String) async throws -> String in
      return try await DraftrewindAiModule.runGenerate(instructions: instructions, prompt: prompt)
    }
  }

  // MARK: - Helpers

  private static func currentAvailability() -> String {
    #if canImport(FoundationModels)
    if #available(iOS 26.0, *) {
      switch SystemLanguageModel.default.availability {
      case .available:
        return "available"
      case .unavailable(let reason):
        switch reason {
        case .deviceNotEligible:
          return "deviceNotEligible"
        case .appleIntelligenceNotEnabled:
          return "notEnabled"
        case .modelNotReady:
          return "notReady"
        @unknown default:
          return "unsupported"
        }
      }
    }
    #endif
    return "unsupported"
  }

  private static func supportsLanguage(_ code: String) -> Bool {
    #if canImport(FoundationModels)
    if #available(iOS 26.0, *) {
      return SystemLanguageModel.default.supportsLocale(Locale(identifier: code))
    }
    #endif
    return false
  }

  private static func runGenerate(instructions: String, prompt: String) async throws -> String {
    #if canImport(FoundationModels)
    if #available(iOS 26.0, *) {
      guard currentAvailability() == "available" else {
        throw Exception(
          name: "AiUnavailable",
          description: "Apple Intelligence is not available on this device right now.",
          code: "ERR_AI_UNAVAILABLE"
        )
      }
      // Defensive cap; JS already truncates to ~6000 characters.
      let safeInstructions = String(instructions.prefix(2000))
      let safePrompt = String(prompt.prefix(8000))
      let session = LanguageModelSession(instructions: safeInstructions)
      do {
        let response = try await session.respond(to: safePrompt)
        return response.content
      } catch let error as LanguageModelSession.GenerationError {
        throw mapGenerationError(error)
      } catch {
        throw Exception(
          name: "AiGenerationFailed",
          description: error.localizedDescription,
          code: "ERR_AI_FAILED"
        )
      }
    }
    #endif
    throw Exception(
      name: "AiUnsupported",
      description: "Apple Intelligence requires iOS 26 or newer.",
      code: "ERR_AI_UNSUPPORTED"
    )
  }

  #if canImport(FoundationModels)
  @available(iOS 26.0, *)
  private static func mapGenerationError(_ error: LanguageModelSession.GenerationError) -> Exception {
    switch error {
    case .exceededContextWindowSize:
      return Exception(name: "AiContextWindow", description: "The text is too long for the on-device model.", code: "ERR_AI_CONTEXT_WINDOW")
    case .guardrailViolation, .refusal:
      return Exception(name: "AiGuardrail", description: "The on-device model declined to answer this request.", code: "ERR_AI_GUARDRAIL")
    case .unsupportedLanguageOrLocale:
      return Exception(name: "AiUnsupportedLanguage", description: "This language is not supported by the on-device model.", code: "ERR_AI_UNSUPPORTED_LANGUAGE")
    case .assetsUnavailable:
      return Exception(name: "AiAssetsUnavailable", description: "The on-device model is not ready yet.", code: "ERR_AI_NOT_READY")
    case .rateLimited, .concurrentRequests:
      return Exception(name: "AiBusy", description: "The on-device model is busy. Try again in a moment.", code: "ERR_AI_BUSY")
    default:
      return Exception(name: "AiGenerationFailed", description: error.localizedDescription, code: "ERR_AI_FAILED")
    }
  }
  #endif
}
