Pod::Spec.new do |s|
  s.name           = 'DraftrewindIcloud'
  s.version        = '1.0.0'
  s.summary        = 'iCloud Drive container access for DraftRewind'
  s.description    = 'Local Expo module that resolves the app iCloud Drive container and triggers downloads of iCloud placeholder files.'
  s.author         = ''
  s.homepage       = 'https://docs.expo.dev/modules/'
  s.platforms      = {
    :ios => '16.4'
  }
  s.swift_version  = '5.9'
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  # Swift/Objective-C compatibility
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
  }

  s.source_files = "**/*.{h,m,mm,swift,hpp,cpp}"
end
