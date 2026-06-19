#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const childProcess = require("node:child_process");

const PROJECT_ROOT = path.resolve(__dirname, "..");
const DIST_DIR = path.join(PROJECT_ROOT, "dist");
const MANAGER_NAME = "Discord Translator Mod Manager";

function main() {
  fs.rmSync(DIST_DIR, { recursive: true, force: true });
  fs.mkdirSync(DIST_DIR, { recursive: true });

  createManagerApp();
  packageCommandApp(MANAGER_NAME);

  console.log(`Built macOS app in ${DIST_DIR}`);
}

function createManagerApp() {
  const appDir = path.join(DIST_DIR, `${MANAGER_NAME}.app`);
  const contentsDir = path.join(appDir, "Contents");
  const macOSDir = path.join(contentsDir, "MacOS");
  const executable = path.join(macOSDir, MANAGER_NAME);
  const sourcePath = path.join(DIST_DIR, "manager.m");

  fs.mkdirSync(macOSDir, { recursive: true });
  fs.writeFileSync(path.join(contentsDir, "Info.plist"), plist(MANAGER_NAME), "utf8");
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

  childProcess.execFileSync("/usr/bin/xattr", ["-cr", appDir], { stdio: "pipe" });
  childProcess.execFileSync("/usr/bin/codesign", ["--force", "--deep", "--sign", "-", appDir], { stdio: "pipe" });
  childProcess.execFileSync("/usr/bin/xattr", ["-cr", appDir], { stdio: "pipe" });
}

function packageCommandApp(name) {
  const appDir = path.join(DIST_DIR, `${name}.app`);
  const zipPath = path.join(DIST_DIR, `${name}.zip`);

  childProcess.execFileSync("/usr/bin/xattr", ["-cr", appDir], { stdio: "pipe" });
  childProcess.execFileSync("/usr/bin/ditto", ["-c", "-k", "--norsrc", "--noextattr", "--keepParent", appDir, zipPath], {
    cwd: DIST_DIR,
    stdio: "pipe"
  });
}

function managerSource({ name }) {
  const projectRoot = objcString(PROJECT_ROOT);
  const installScript = objcString(path.join(PROJECT_ROOT, "scripts", "install.js"));
  const uninstallScript = objcString(path.join(PROJECT_ROOT, "scripts", "uninstall.js"));
  const appName = objcString(name);

  return `#import <Cocoa/Cocoa.h>
#import <Foundation/Foundation.h>
#import <sys/utsname.h>

static NSString *const ProjectRoot = @${projectRoot};
static NSString *const InstallScript = @${installScript};
static NSString *const UninstallScript = @${uninstallScript};
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

static NSString *TailLog(NSString *logPath) {
  NSString *content = [NSString stringWithContentsOfFile:logPath encoding:NSUTF8StringEncoding error:nil];
  if (content.length == 0) {
    return @"No log output was captured.";
  }

  NSArray<NSString *> *lines = [content componentsSeparatedByCharactersInSet:[NSCharacterSet newlineCharacterSet]];
  NSUInteger start = lines.count > 12 ? lines.count - 12 : 0;
  NSIndexSet *indexes = [NSIndexSet indexSetWithIndexesInRange:NSMakeRange(start, lines.count - start)];
  NSArray<NSString *> *tail = [lines objectsAtIndexes:indexes];
  return [tail componentsJoinedByString:@"\\n"];
}

static NSString *ShellQuote(NSString *value) {
  NSString *escaped = [value stringByReplacingOccurrencesOfString:@"'" withString:@"'\\\\''"];
  return [NSString stringWithFormat:@"'%@'", escaped];
}

static NSString *AppleScriptStringLiteral(NSString *value) {
  NSMutableString *escaped = [value mutableCopy];
  [escaped replaceOccurrencesOfString:@"\\\\" withString:@"\\\\\\\\" options:0 range:NSMakeRange(0, escaped.length)];
  [escaped replaceOccurrencesOfString:@"\\"" withString:@"\\\\\\"" options:0 range:NSMakeRange(0, escaped.length)];
  [escaped replaceOccurrencesOfString:@"\\n" withString:@"\\\\n" options:0 range:NSMakeRange(0, escaped.length)];
  return [NSString stringWithFormat:@"\\"%@\\"", escaped];
}

static BOOL RunPrivilegedShellCommand(NSString *command, NSString **errorMessage) {
  NSString *source = [NSString stringWithFormat:@"do shell script %@ with administrator privileges", AppleScriptStringLiteral(command)];
  NSAppleScript *script = [[NSAppleScript alloc] initWithSource:source];
  NSDictionary *errorInfo = nil;
  NSAppleEventDescriptor *result = [script executeAndReturnError:&errorInfo];
  if (result != nil) {
    return YES;
  }

  NSString *message = errorInfo[NSAppleScriptErrorMessage];
  if (message.length == 0) {
    message = @"The privileged installer command failed.";
  }
  if (errorMessage != NULL) {
    *errorMessage = message;
  }
  return NO;
}

static int RunNodeScript(NSString *scriptPath, NSString *successMessage) {
  BOOL useArm64Runner = NO;
  NSString *nodePath = FindNativeNode(&useArm64Runner);
  if (nodePath == nil) {
    ShowAlert(AppName, @"Native arm64 Node.js was not found. Install the Apple Silicon build from https://nodejs.org or Homebrew under /opt/homebrew, then run this manager again. No Rosetta is required.");
    return 1;
  }

  NSString *logPath = [NSTemporaryDirectory() stringByAppendingPathComponent:@"discord-translator-mod-manager.log"];
  [[NSFileManager defaultManager] createFileAtPath:logPath contents:nil attributes:nil];

  NSString *nodeCommand = nil;
  if (useArm64Runner) {
    nodeCommand = [NSString stringWithFormat:@"%@ -arm64 %@ %@",
      ShellQuote(@"/usr/bin/arch"),
      ShellQuote(nodePath),
      ShellQuote(scriptPath)
    ];
  } else {
    nodeCommand = [NSString stringWithFormat:@"%@ %@",
      ShellQuote(nodePath),
      ShellQuote(scriptPath)
    ];
  }

  NSString *command = [NSString stringWithFormat:@"cd %@ && %@ > %@ 2>&1",
    ShellQuote(ProjectRoot),
    nodeCommand,
    ShellQuote(logPath)
  ];

  NSString *errorMessage = nil;
  if (RunPrivilegedShellCommand(command, &errorMessage)) {
    ShowAlert(AppName, successMessage);
    return 0;
  }

  NSString *tail = TailLog(logPath);
  ShowAlert(AppName, tail.length > 0 ? tail : errorMessage);
  return 1;
}

int main(int argc, const char *argv[]) {
  @autoreleasepool {
    [NSApplication sharedApplication];
    [NSApp setActivationPolicy:NSApplicationActivationPolicyRegular];
    [NSApp activateIgnoringOtherApps:YES];

    NSAlert *alert = [[NSAlert alloc] init];
    alert.messageText = AppName;
    alert.informativeText = @"Choose what to do with Discord Translator Mod.";
    [alert addButtonWithTitle:@"Install"];
    [alert addButtonWithTitle:@"Uninstall"];
    [alert addButtonWithTitle:@"Cancel"];

    NSModalResponse response = [alert runModal];
    if (response == NSAlertFirstButtonReturn) {
      return RunNodeScript(InstallScript, @"Discord Translator Mod installed. Quit and reopen Discord to use it.");
    }
    if (response == NSAlertSecondButtonReturn) {
      return RunNodeScript(UninstallScript, @"Discord Translator Mod removed. Quit and reopen Discord.");
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
