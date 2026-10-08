const fs = require('fs');
const path = require('path');

console.log('--- Configuring Signing & Entitlements for App Store Release ---');

const TEAM_ID = 'U99V9TSK2X';
const APP_PROFILE = 'DraftRewind AppStore Profile';
const WIDGET_PROFILE = 'DraftRewind Widgets AppStore Profile';

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
        console.log(`Removing 'aps-environment' from ${fullPath}...`);
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

  // In TargetAttributes, add DevelopmentTeam and ProvisioningStyle for all targets
  const targetAttrMatch = pbx.match(/TargetAttributes\s*=\s*{[\s\S]*?};/);
  if (targetAttrMatch) {
    let targetAttr = targetAttrMatch[0];
    targetAttr = targetAttr.replace(/([0-9A-Fa-f]{24}\s*=\s*{\s*)/g, (match, prefix) => {
      return `${prefix}DevelopmentTeam = ${TEAM_ID};\n\t\t\t\t\tProvisioningStyle = Manual;\n\t\t\t\t\t`;
    });
    pbx = pbx.replace(targetAttrMatch[0], targetAttr);
  }

  // Find all buildSettings blocks and inject DEVELOPMENT_TEAM, CODE_SIGN_STYLE, CODE_SIGN_IDENTITY
  // Match each XCBuildConfiguration block
  const configRegex = /([0-9A-Fa-f]{24}\s*\/\*[^*]+\*\/\s*=\s*{\s*isa = XCBuildConfiguration;\s*buildSettings = {)([\s\S]*?)(};)/g;
  pbx = pbx.replace(configRegex, (match, header, settings, footer) => {
    let s = settings;
    // Remove duplicate/old settings
    s = s.replace(/DEVELOPMENT_TEAM\s*=[^;]*;/g, '');
    s = s.replace(/PROVISIONING_PROFILE_SPECIFIER\s*=[^;]*;/g, '');
    s = s.replace(/CODE_SIGN_STYLE\s*=[^;]*;/g, '');

    // Add baseline signing
    s += `\n\t\t\t\tDEVELOPMENT_TEAM = ${TEAM_ID};`;
    s += `\n\t\t\t\tCODE_SIGN_STYLE = Manual;`;
    s += `\n\t\t\t\t"CODE_SIGN_IDENTITY[sdk=iphoneos*]" = "Apple Distribution";`;

    // Match widget target
    if (s.includes('com.draftrewind.app.widgets') || s.includes('ExpoWidgetsTarget')) {
      s += `\n\t\t\t\tPROVISIONING_PROFILE_SPECIFIER = "${WIDGET_PROFILE}";`;
    } else if (s.includes('com.draftrewind.app') || s.includes('PRODUCT_NAME = DraftRewind') || s.includes('DraftRewind/Info.plist')) {
      s += `\n\t\t\t\tPROVISIONING_PROFILE_SPECIFIER = "${APP_PROFILE}";`;
    }

    return header + s + '\n\t\t\t' + footer;
  });

  fs.writeFileSync(pbxPath, pbx, 'utf8');
  console.log(`✓ Successfully configured DevelopmentTeam (${TEAM_ID}) and Provisioning Profiles in project.pbxproj`);
} else {
  console.warn('⚠️ Warning: ios/DraftRewind.xcodeproj/project.pbxproj not found!');
}
