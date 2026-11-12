Pod::Spec.new do |s|
  s.name           = 'DraftrewindStore'
  s.version        = '1.0.0'
  s.summary        = 'One-time in-app purchase (StoreKit 2) for DraftRewind'
  s.description    = 'Local Expo module that loads, buys and restores the DraftRewind Pro non-consumable with StoreKit 2.'
  s.author         = ''
  s.homepage       = 'https://docs.expo.dev/modules/'
  s.platforms      = {
    :ios => '16.4'
  }
  s.swift_version  = '5.9'
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'
  s.frameworks = 'StoreKit'

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
  }

  s.source_files = "**/*.{h,m,mm,swift,hpp,cpp}"
end
