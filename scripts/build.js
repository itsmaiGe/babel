#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const childProcess = require("node:child_process");

const PROJECT_ROOT = path.resolve(__dirname, "..");
const DIST_DIR = path.join(PROJECT_ROOT, "dist");
const MANAGER_NAME = "Babel Manager";

function main() {
  fs.rmSync(DIST_DIR, { recursive: true, force: true });
  fs.mkdirSync(DIST_DIR, { recursive: true });

  const buildRoot = fs.mkdtempSync(path.join(os.tmpdir(), "dtm-manager-build-"));
  try {
    const appDir = createManagerApp(buildRoot);
    copyAppBundle(appDir, path.join(DIST_DIR, `${MANAGER_NAME}.app`));
    packageCommandApp(appDir, MANAGER_NAME);
  } finally {
    fs.rmSync(buildRoot, { recursive: true, force: true });
  }

  buildWindowsDist();

  console.log(`Built macOS app and Windows package in ${DIST_DIR}`);
}

function buildWindowsDist() {
  const stageDir = path.join(DIST_DIR, "Babel-Windows");
  const payloadDir = path.join(stageDir, "payload");

  for (const name of ["Babel.bat", "Babel-Manager.ps1", "Install-Babel.ps1", "Uninstall-Babel.ps1"]) {
    copyFile(path.join(PROJECT_ROOT, "scripts", "windows", name), path.join(stageDir, name));
  }
  copyFile(path.join(PROJECT_ROOT, "assets", "babel.ico"), path.join(stageDir, "babel.ico"));
  copyStripped(path.join(PROJECT_ROOT, "src", "mod", "main.js"), path.join(payloadDir, "mod", "main.js"));
  copyFile(path.join(PROJECT_ROOT, "src", "mod", "preload.js"), path.join(payloadDir, "mod", "preload.js"));
  copyStripped(path.join(PROJECT_ROOT, "src", "mod", "renderer.js"), path.join(payloadDir, "mod", "renderer.js"));
  copyDirectory(path.join(PROJECT_ROOT, "src", "shared"), path.join(payloadDir, "shared"));

  childProcess.execFileSync("/usr/bin/ditto", ["-c", "-k", "--norsrc", "--keepParent", stageDir, path.join(DIST_DIR, "Babel-Windows.zip")], { stdio: "pipe" });
}

function createManagerApp(buildRoot) {
  const appDir = path.join(buildRoot, `${MANAGER_NAME}.app`);
  const contentsDir = path.join(appDir, "Contents");
  const macOSDir = path.join(contentsDir, "MacOS");
  const resourcesDir = path.join(contentsDir, "Resources");
  const executable = path.join(macOSDir, MANAGER_NAME);
  const sourcePath = path.join(buildRoot, "manager.m");

  fs.mkdirSync(macOSDir, { recursive: true });
  fs.mkdirSync(resourcesDir, { recursive: true });
  fs.writeFileSync(path.join(contentsDir, "Info.plist"), plist(MANAGER_NAME), "utf8");
  copyFile(path.join(PROJECT_ROOT, "assets", "babel.icns"), path.join(resourcesDir, "babel.icns"));
  copyManagerResources(resourcesDir);
  fs.writeFileSync(sourcePath, managerSource({ name: MANAGER_NAME }), "utf8");

  childProcess.execFileSync("/usr/bin/clang", [
    "-arch",
    "arm64",
    "-mmacosx-version-min=11.0",
    "-fobjc-arc",
    "-framework",
    "Cocoa",
    sourcePath,
    "-o",
    executable
  ], {
    stdio: "pipe"
  });

  fs.rmSync(sourcePath, { force: true });
  fs.chmodSync(executable, 0o755);

  clearExtendedAttributes(appDir);
  childProcess.execFileSync("/usr/bin/codesign", ["--force", "--deep", "--sign", "-", appDir], { stdio: "pipe" });
  clearExtendedAttributes(appDir);

  return appDir;
}

function packageCommandApp(appDir, name) {
  const zipPath = path.join(DIST_DIR, `${name}.zip`);

  clearExtendedAttributes(appDir);
  childProcess.execFileSync("/usr/bin/ditto", ["-c", "-k", "--norsrc", "--noextattr", "--keepParent", appDir, zipPath], {
    stdio: "pipe"
  });
}

function copyAppBundle(source, dest) {
  fs.rmSync(dest, { recursive: true, force: true });
  childProcess.execFileSync("/usr/bin/ditto", ["--norsrc", "--noextattr", source, dest], { stdio: "pipe" });
}

function clearExtendedAttributes(target) {
  for (const attr of ["com.apple.FinderInfo", "com.apple.fileprovider.fpfs#P", "com.apple.provenance"]) {
    childProcess.spawnSync("/usr/bin/xattr", ["-dr", attr, target], { stdio: "ignore" });
  }
  childProcess.spawnSync("/usr/bin/xattr", ["-cr", target], { stdio: "ignore" });
}

function copyManagerResources(resourcesDir) {
  const payloadDir = path.join(resourcesDir, "payload");
  const scriptsDir = path.join(resourcesDir, "scripts");

  // Strip test-only scaffolding so it never ships in the running plugin.
  copyStripped(path.join(PROJECT_ROOT, "src", "mod", "main.js"), path.join(payloadDir, "mod", "main.js"));
  copyFile(path.join(PROJECT_ROOT, "src", "mod", "preload.js"), path.join(payloadDir, "mod", "preload.js"));
  copyStripped(path.join(PROJECT_ROOT, "src", "mod", "renderer.js"), path.join(payloadDir, "mod", "renderer.js"));
  copyDirectory(path.join(PROJECT_ROOT, "src", "shared"), path.join(payloadDir, "shared"));
  copyFile(path.join(PROJECT_ROOT, "scripts", "desktop-core-action.js"), path.join(scriptsDir, "desktop-core-action.js"));
}

const TEST_ONLY_BLOCK = /\/\* @dtm-test-only:start[\s\S]*?@dtm-test-only:end \*\/\n?/g;

function copyFile(source, dest) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(source, dest);
}

function copyStripped(source, dest) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, fs.readFileSync(source, "utf8").replace(TEST_ONLY_BLOCK, ""), "utf8");
}

function copyDirectory(source, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    const sourcePath = path.join(source, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDirectory(sourcePath, destPath);
    } else if (entry.isFile()) {
      copyFile(sourcePath, destPath);
    }
  }
}

function managerSource({ name }) {
  const appName = objcString(name);

  return `#import <Cocoa/Cocoa.h>
#import <Foundation/Foundation.h>
#import <sys/utsname.h>

static NSString *const AppName = @${appName};

static BOOL IsAppleSilicon(void) {
  struct utsname systemInfo;
  if (uname(&systemInfo) != 0) {
    return NO;
  }
  return strcmp(systemInfo.machine, "arm64") == 0;
}

static void ShowAlert(NSString *message, NSString *info) {
  NSAlert *alert = [[NSAlert alloc] init];
  alert.messageText = message;
  alert.informativeText = info ?: @"";
  [alert addButtonWithTitle:@"OK"];
  [alert runModal];
}

static NSString *RunAndCapture(NSString *executable, NSArray<NSString *> *arguments) {
  NSTask *task = [[NSTask alloc] init];
  task.executableURL = [NSURL fileURLWithPath:executable];
  task.arguments = arguments;

  NSPipe *pipe = [NSPipe pipe];
  task.standardOutput = pipe;
  task.standardError = pipe;

  NSError *error = nil;
  if (![task launchAndReturnError:&error]) {
    return @"";
  }

  [task waitUntilExit];
  NSData *data = [[pipe fileHandleForReading] readDataToEndOfFile];
  NSString *output = [[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding];
  return output ?: @"";
}

static BOOL RunNodeAndCapture(NSString *nodePath, BOOL useArm64Runner, NSArray<NSString *> *nodeArguments, NSString **output, NSString **errorMessage) {
  NSTask *task = [[NSTask alloc] init];
  if (useArm64Runner) {
    NSMutableArray<NSString *> *arguments = [NSMutableArray arrayWithObjects:@"-arm64", nodePath, nil];
    [arguments addObjectsFromArray:nodeArguments];
    task.executableURL = [NSURL fileURLWithPath:@"/usr/bin/arch"];
    task.arguments = arguments;
  } else {
    task.executableURL = [NSURL fileURLWithPath:nodePath];
    task.arguments = nodeArguments;
  }

  NSPipe *stdoutPipe = [NSPipe pipe];
  NSPipe *stderrPipe = [NSPipe pipe];
  task.standardOutput = stdoutPipe;
  task.standardError = stderrPipe;

  NSError *launchError = nil;
  if (![task launchAndReturnError:&launchError]) {
    if (errorMessage != NULL) {
      *errorMessage = launchError.localizedDescription ?: @"Failed to launch Node.js.";
    }
    return NO;
  }

  [task waitUntilExit];
  NSData *stdoutData = [[stdoutPipe fileHandleForReading] readDataToEndOfFile];
  NSData *stderrData = [[stderrPipe fileHandleForReading] readDataToEndOfFile];
  NSString *stdoutText = [[NSString alloc] initWithData:stdoutData encoding:NSUTF8StringEncoding] ?: @"";
  NSString *stderrText = [[NSString alloc] initWithData:stderrData encoding:NSUTF8StringEncoding] ?: @"";

  if (output != NULL) {
    *output = stdoutText;
  }
  if (task.terminationStatus == 0) {
    return YES;
  }

  if (errorMessage != NULL) {
    *errorMessage = stderrText.length > 0 ? stderrText : (stdoutText.length > 0 ? stdoutText : @"Node.js command failed.");
  }
  return NO;
}

static NSString *FindNativeNode(BOOL *useArm64Runner) {
  NSArray<NSString *> *candidates = @[
    @"/opt/homebrew/bin/node",
    @"/usr/local/bin/node",
    @"/usr/bin/node"
  ];
  NSFileManager *fileManager = [NSFileManager defaultManager];
  BOOL appleSilicon = IsAppleSilicon();

  for (NSString *candidate in candidates) {
    if (![fileManager isExecutableFileAtPath:candidate]) {
      continue;
    }

    if (!appleSilicon) {
      *useArm64Runner = NO;
      return candidate;
    }

    NSString *archs = RunAndCapture(@"/usr/bin/lipo", @[@"-archs", candidate]);
    if ([archs rangeOfString:@"arm64"].location != NSNotFound) {
      *useArm64Runner = YES;
      return candidate;
    }
  }

  return nil;
}

static int RunAction(NSString *action, NSString *successMessage) {
  BOOL useArm64Runner = NO;
  NSString *nodePath = FindNativeNode(&useArm64Runner);
  if (nodePath == nil) {
    ShowAlert(AppName, @"Native arm64 Node.js was not found. Install the Apple Silicon build from https://nodejs.org or Homebrew under /opt/homebrew, then run this manager again. No Rosetta is required.");
    return 1;
  }

  NSString *resourcePath = [[NSBundle mainBundle] resourcePath];
  NSString *scriptPath = [resourcePath stringByAppendingPathComponent:@"scripts/desktop-core-action.js"];
  NSString *payloadSource = [resourcePath stringByAppendingPathComponent:@"payload"];
  NSString *errorMessage = nil;
  NSString *output = nil;
  BOOL ok = RunNodeAndCapture(nodePath, useArm64Runner, @[
    scriptPath,
    action,
    @"--payload-source",
    payloadSource
  ], &output, &errorMessage);
  if (ok) {
    ShowAlert(AppName, successMessage);
    return 0;
  }

  ShowAlert(AppName, errorMessage ?: @"Babel action failed.");
  return 1;
}

int main(int argc, const char *argv[]) {
  @autoreleasepool {
    [NSApplication sharedApplication];
    [NSApp setActivationPolicy:NSApplicationActivationPolicyRegular];
    [NSApp activateIgnoringOtherApps:YES];

    NSAlert *alert = [[NSAlert alloc] init];
    alert.messageText = AppName;
    alert.informativeText = @"Choose what to do with Babel.";
    [alert addButtonWithTitle:@"Install"];
    [alert addButtonWithTitle:@"Uninstall"];
    [alert addButtonWithTitle:@"Cancel"];

    NSModalResponse response = [alert runModal];
    if (response == NSAlertFirstButtonReturn) {
      return RunAction(@"install", @"Babel installed. Quit and reopen Discord to use it.");
    }
    if (response == NSAlertSecondButtonReturn) {
      return RunAction(@"uninstall", @"Babel removed. Quit and reopen Discord.");
    }

    return 0;
  }
}
`;
}

function plist(name) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleExecutable</key>
  <string>${escapeXml(name)}</string>
  <key>CFBundleIconFile</key>
  <string>babel</string>
  <key>CFBundleIdentifier</key>
  <string>local.discord-translator-mod.${bundleSuffix(name)}</string>
  <key>CFBundleName</key>
  <string>${escapeXml(name)}</string>
  <key>CFBundlePackageType</key>
  <string>APPL</string>
  <key>CFBundleShortVersionString</key>
  <string>0.1.0</string>
  <key>CFBundleVersion</key>
  <string>1</string>
</dict>
</plist>
`;
}

function objcString(value) {
  return `"${String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n")}"`;
}

function escapeXml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function bundleSuffix(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

if (require.main === module) {
  main();
}

module.exports = {
  managerSource
};
