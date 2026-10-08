const fs = require('fs');
const path = require('path');

console.log('--- Configuring Signing & Entitlements for App Store Release ---');

// 1. Remove aps-environment from any .entitlements files in ios/
function cleanEntitlements(dir) {
  if (!fs.existsSync(dir)) return;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      cleanEntitlements(fullPath);
    } else if (entry.isFile() && entry.name.endsWith('.entitlements')) {
      let content = fs.readFileSync(fullPath, 'utf8');
      if (content.includes('aps-environment')) {
        console.log(`Removing 'aps-environment' from ${fullPath} (app only uses local notifications)...`);
        content = content.replace(/<key>aps-environment<\/key>\s*<string>[^<]*<\/string>/g, '');
        fs.writeFileSync(fullPath, content, 'utf8');
      }
    }
  }
}

cleanEntitlements(path.join(__dirname, '..', 'ios'));

// 2. Configure project.pbxproj
const pbxPath = path.join(__dirname, '..', 'ios', 'DraftRewind.xcodeproj', 'project.pbxproj');
if (fs.existsSync(pbxPath)) {
  let pbx = fs.readFileSync(pbxPath, 'utf8');

  // Change all signing styles to Manual
  pbx = pbx.replace(/ProvisioningStyle = Automatic;/g, 'ProvisioningStyle = Manual;');
  pbx = pbx.replace(/CODE_SIGN_STYLE = Automatic;/g, 'CODE_SIGN_STYLE = Manual;');

  // Split into sections or lines to set PROVISIONING_PROFILE_SPECIFIER per target
  // Match each XCBuildConfiguration block
  const configBlockRegex = /(\/\* (?:Debug|Release) \*\/ = {\s*isa = XCBuildConfiguration;\s*buildSettings = {)([\s\S]*?)(};)/g;

  pbx = pbx.replace(configBlockRegex, (match, prefix, settings, suffix) => {
    let s = settings;

    // Check if this configuration is for the widget extension
    if (s.includes('com.draftrewind.app.widgets') || s.includes('ExpoWidgetsTarget')) {
      s = s.replace(/PROVISIONING_PROFILE_SPECIFIER\s*=[^;]*;/g, '');
      s += '\n\t\t\t\tPROVISIONING_PROFILE_SPECIFIER = "DraftRewind Widgets AppStore Profile";';
      s += '\n\t\t\t\tDEVELOPMENT_TEAM = U99V9TSK2X;';
      s += '\n\t\t\t\tCODE_SIGN_STYLE = Manual;';
      s += '\n\t\t\t\t"CODE_SIGN_IDENTITY[sdk=iphoneos*]" = "Apple Distribution";';
      return prefix + s + '\n\t\t\t' + suffix;
    }

    // Check if this configuration is for the main app
    if (s.includes('com.draftrewind.app') || s.includes('PRODUCT_NAME = DraftRewind')) {
      s = s.replace(/PROVISIONING_PROFILE_SPECIFIER\s*=[^;]*;/g, '');
      s += '\n\t\t\t\tPROVISIONING_PROFILE_SPECIFIER = "DraftRewind AppStore Profile";';
      s += '\n\t\t\t\tDEVELOPMENT_TEAM = U99V9TSK2X;';
      s += '\n\t\t\t\tCODE_SIGN_STYLE = Manual;';
      s += '\n\t\t\t\t"CODE_SIGN_IDENTITY[sdk=iphoneos*]" = "Apple Distribution";';
      return prefix + s + '\n\t\t\t' + suffix;
    }

    return match;
  });

  fs.writeFileSync(pbxPath, pbx, 'utf8');
  console.log('✓ Successfully configured Manual Signing and Provisioning Profiles in project.pbxproj');
} else {
  console.warn('⚠️ Warning: ios/DraftRewind.xcodeproj/project.pbxproj not found!');
}
