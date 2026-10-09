Pod::Spec.new do |s|
  s.name           = 'DraftrewindGit'
  s.version        = '1.0.0'
  s.summary        = 'Native SHA-1 and zlib for the DraftRewind git engine'
  s.description    = 'Local Expo module: SHA-1 and zlib deflate/inflate on a background queue so the JS thread (and the UI) stays responsive.'
  s.author         = ''
  s.homepage       = 'https://docs.expo.dev/modules/'
  s.platforms      = {
    :ios => '16.4'
  }
  s.swift_version  = '5.9'
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
  }

  s.source_files = "**/*.{h,m,mm,swift,hpp,cpp}"
end
