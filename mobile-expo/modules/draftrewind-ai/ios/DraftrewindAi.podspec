Pod::Spec.new do |s|
  s.name           = 'DraftrewindAi'
  s.version        = '1.0.0'
  s.summary        = 'On-device Apple Intelligence (Foundation Models) for DraftRewind'
  s.description    = 'Local Expo module that exposes the iOS 26 Foundation Models on-device language model to JavaScript.'
  s.author         = ''
  s.homepage       = 'https://docs.expo.dev/modules/'
  s.platforms      = {
    :ios => '16.4'
  }
  s.swift_version  = '5.9'
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  # FoundationModels only exists on iOS 26+. Weak-link it so the app still launches on iOS 16.4–18.
  s.weak_frameworks = 'FoundationModels'

  # Swift/Objective-C compatibility
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
  }

  s.source_files = "**/*.{h,m,mm,swift,hpp,cpp}"
end
