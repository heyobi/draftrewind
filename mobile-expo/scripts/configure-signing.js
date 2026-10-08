const fs = require('fs');
const path = require('path');

console.log('--- Configuring Signing & Entitlements for App Store Release ---');

const TEAM_ID = 'U99V9TSK2X';
const APP_PROFILE_NAME = 'DraftRewind AppStore Profile';
const APP_PROFILE_UUID = '833cf625-a225-4288-a388-d36f091a5e6f';
const WIDGET_PROFILE_NAME = 'DraftRewind Widgets AppStore Profile';
const WIDGET_PROFILE_UUID = 'd2c98500-ecdd-462e-b7f7-681f7e1dc608';

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

  // Change all signing styles to Manual globally
  pbx = pbx.replace(/ProvisioningStyle = Automatic;/g, 'ProvisioningStyle = Manual;');
  pbx = pbx.replace(/CODE_SIGN_STYLE = Automatic;/g, 'CODE_SIGN_STYLE = Manual;');

  // Find all PBXNativeTarget blocks
  const targetMap = {}; // configId -> targetName
  const targets = {};   // targetId -> { name, listId }
  
  const nativeTargetSection = pbx.match(/\/\* Begin PBXNativeTarget section \*\/([\s\S]*?)\/\* End PBXNativeTarget section \*\//);
  if (nativeTargetSection) {
    const sectionBody = nativeTargetSection[1];
    const targetBlocks = sectionBody.match(/([0-9A-Fa-f]{24})\s*(?:\/\*[^*]*\*\/)?\s*=\s*{[\s\S]*?};/g) || [];
    for (const block of targetBlocks) {
      const idMatch = block.match(/^([0-9A-Fa-f]{24})/);
      const nameMatch = block.match(/name\s*=\s*"?([^";]+)"?;/);
      const listMatch = block.match(/buildConfigurationList\s*=\s*([0-9A-Fa-f]{24})/);
      if (idMatch && nameMatch && listMatch) {
        const id = idMatch[1];
        const name = nameMatch[1].trim();
        const listId = listMatch[1];
        targets[id] = { name, listId };
      }
    }
  }
  console.log('Detected Targets in PBXNativeTarget:', targets);

  // Map configuration list IDs to target names
  const configListSection = pbx.match(/\/\* Begin XCConfigurationList section \*\/([\s\S]*?)\/\* End XCConfigurationList section \*\//);
  if (configListSection) {
    const listBody = configListSection[1];
    for (const [targetId, targetInfo] of Object.entries(targets)) {
      const listBlockMatch = listBody.match(new RegExp(targetInfo.listId + '[\\s\\S]*?buildConfigurations\\s*=\\s*\\(([\\s\\S]*?)\\);'));
      if (listBlockMatch) {
        const configIds = (listBlockMatch[1].match(/[0-9A-Fa-f]{24}/g) || []);
        for (const cid of configIds) {
          targetMap[cid] = targetInfo.name;
        }
      }
    }
  }
  console.log('Target Configuration Map:', targetMap);

  // Update TargetAttributes in PBXProject
  const targetAttrIdx = pbx.indexOf('TargetAttributes = {');
  if (targetAttrIdx !== -1) {
    let braceCount = 0;
    let endIdx = -1;
    for (let i = targetAttrIdx; i < pbx.length; i++) {
      if (pbx[i] === '{') braceCount++;
      else if (pbx[i] === '}') {
        braceCount--;
        if (braceCount === 0) {
          endIdx = i + 1;
          break;
        }
      }
    }
    if (endIdx !== -1) {
      const headerLen = 'TargetAttributes = {'.length;
      let body = pbx.substring(targetAttrIdx + headerLen, endIdx - 1);
      for (const [targetId, targetInfo] of Object.entries(targets)) {
        const targetRegex = new RegExp(`(${targetId}[^=]*=\\s*{)([\\s\\S]*?)(};)`);
        if (targetRegex.test(body)) {
          body = body.replace(targetRegex, (m, start, content, end) => {
            content = content.replace(/DevelopmentTeam\s*=[^;]*;/g, '');
            content = content.replace(/ProvisioningStyle\s*=[^;]*;/g, '');
            return `${start}\n\t\t\t\t\t\tDevelopmentTeam = ${TEAM_ID};\n\t\t\t\t\t\tProvisioningStyle = Manual;${content}\n\t\t\t\t\t${end}`;
          });
        } else {
          body += `\n\t\t\t\t\t${targetId} = {\n\t\t\t\t\t\tDevelopmentTeam = ${TEAM_ID};\n\t\t\t\t\t\tProvisioningStyle = Manual;\n\t\t\t\t\t};`;
        }
      }
      pbx = pbx.substring(0, targetAttrIdx + headerLen) + body + pbx.substring(endIdx - 1);
    }
  }

  // Update XCBuildConfiguration blocks
  let appConfigsCount = 0;
  let widgetConfigsCount = 0;

  const configRegex = /([0-9A-Fa-f]{24}\s*(?:\/\*[^*]*\*\/)?\s*=\s*{\s*isa = XCBuildConfiguration;\s*buildSettings = {)([\s\S]*?)(};)/g;
  pbx = pbx.replace(configRegex, (match, header, settings, footer) => {
    const idMatch = header.match(/^([0-9A-Fa-f]{24})/);
    const configId = idMatch ? idMatch[1] : null;
    const targetName = configId ? targetMap[configId] : null;

    let s = settings;
    // Strip old signing settings
    s = s.replace(/DEVELOPMENT_TEAM\s*=[^;]*;/g, '');
    s = s.replace(/PROVISIONING_PROFILE(?:_SPECIFIER)?\s*=[^;]*;/g, '');
    s = s.replace(/CODE_SIGN_STYLE\s*=[^;]*;/g, '');
    s = s.replace(/CODE_SIGN_IDENTITY(?:\[sdk=[^\]]+\])?\s*=[^;]*;/g, '');

    s += `\n\t\t\t\tDEVELOPMENT_TEAM = ${TEAM_ID};`;
    s += `\n\t\t\t\tCODE_SIGN_STYLE = Manual;`;
    s += `\n\t\t\t\tCODE_SIGN_IDENTITY = "Apple Distribution";`;
    s += `\n\t\t\t\t"CODE_SIGN_IDENTITY[sdk=iphoneos*]" = "Apple Distribution";`;

    const isWidget = targetName === 'ExpoWidgetsTarget' || targetName?.toLowerCase().includes('widget') || s.includes('com.draftrewind.app.widgets');
    const isApp = targetName === 'DraftRewind' || targetName?.toLowerCase().includes('draftrewind') || s.includes('com.draftrewind.app');

    if (isWidget) {
      s += `\n\t\t\t\tPROVISIONING_PROFILE = "${WIDGET_PROFILE_UUID}";`;
      s += `\n\t\t\t\tPROVISIONING_PROFILE_SPECIFIER = "${WIDGET_PROFILE_NAME}";`;
      widgetConfigsCount++;
      console.log(`  ✓ Configured build config ${configId} for target '${targetName || 'Widget'}' with profile ${WIDGET_PROFILE_NAME} (${WIDGET_PROFILE_UUID})`);
    } else if (isApp) {
      s += `\n\t\t\t\tPROVISIONING_PROFILE = "${APP_PROFILE_UUID}";`;
      s += `\n\t\t\t\tPROVISIONING_PROFILE_SPECIFIER = "${APP_PROFILE_NAME}";`;
      appConfigsCount++;
      console.log(`  ✓ Configured build config ${configId} for target '${targetName || 'DraftRewind'}' with profile ${APP_PROFILE_NAME} (${APP_PROFILE_UUID})`);
    } else {
      console.log(`  ✓ Configured generic build config ${configId} for target '${targetName || 'Project'}'`);
    }

    return header + s + '\n\t\t\t' + footer;
  });

  fs.writeFileSync(pbxPath, pbx, 'utf8');
  console.log(`--- Configuration Summary ---`);
  console.log(`Main App configs patched: ${appConfigsCount}`);
  console.log(`Widget configs patched: ${widgetConfigsCount}`);
  if (appConfigsCount === 0 || widgetConfigsCount === 0) {
    console.warn('⚠️ WARNING: Some target configurations might not have been matched!');
  } else {
    console.log('✓ All target signing settings successfully updated in project.pbxproj!');
  }
} else {
  console.warn('⚠️ Warning: ios/DraftRewind.xcodeproj/project.pbxproj not found!');
}
