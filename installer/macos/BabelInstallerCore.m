#import "BabelInstallerCore.h"

static NSString *const BabelErrorDomain = @"local.discord-translator-mod.installer";
static NSString *const LoaderMarker = @"DiscordTranslatorMod desktop-core loader";
static NSString *const BlockStart = @"/* DiscordTranslatorMod desktop-core loader:start */";
static NSString *const BlockEnd = @"/* DiscordTranslatorMod desktop-core loader:end */";
static NSString *const PayloadDirName = @"discord-translator-mod";
static NSString *const BackupName = @"index.js.dtm-original";
static NSString *const VanillaIndex = @"module.exports = require('./core.asar');\n";

static BOOL Fail(NSError **error, NSString *message) {
  if (error != NULL) {
    *error = [NSError errorWithDomain:BabelErrorDomain code:1 userInfo:@{NSLocalizedDescriptionKey: message}];
  }
  return NO;
}

static NSArray<NSNumber *> *VersionTuple(NSString *name) {
  NSString *value = [name hasPrefix:@"app-"] ? [name substringFromIndex:4] : name;
  NSArray<NSString *> *parts = [value componentsSeparatedByString:@"."];
  if (parts.count != 3) return nil;
  NSCharacterSet *digits = [NSCharacterSet decimalDigitCharacterSet];
  NSMutableArray<NSNumber *> *numbers = [NSMutableArray arrayWithCapacity:3];
  for (NSString *part in parts) {
    if (part.length == 0 || [[part stringByTrimmingCharactersInSet:digits] length] != 0) return nil;
    [numbers addObject:@(part.integerValue)];
  }
  return numbers;
}

static NSComparisonResult CompareVersionNames(NSString *left, NSString *right) {
  BOOL leftApp = [left hasPrefix:@"app-"];
  BOOL rightApp = [right hasPrefix:@"app-"];
  if (leftApp != rightApp) return leftApp ? NSOrderedAscending : NSOrderedDescending;
  NSArray<NSNumber *> *a = VersionTuple(left);
  NSArray<NSNumber *> *b = VersionTuple(right);
  for (NSUInteger i = 0; i < 3; i += 1) {
    if (a[i].integerValue > b[i].integerValue) return NSOrderedAscending;
    if (a[i].integerValue < b[i].integerValue) return NSOrderedDescending;
  }
  return NSOrderedSame;
}

static BOOL IsCoreDirectory(NSString *path) {
  NSFileManager *fm = [NSFileManager defaultManager];
  return [fm fileExistsAtPath:[path stringByAppendingPathComponent:@"core.asar"]]
    && [fm fileExistsAtPath:[path stringByAppendingPathComponent:@"package.json"]];
}

static NSString *CoreDirectory(NSString *modulesDir) {
  NSFileManager *fm = [NSFileManager defaultManager];
  NSArray<NSString *> *entries = [fm contentsOfDirectoryAtPath:modulesDir error:nil] ?: @[];
  NSMutableArray<NSDictionary *> *wrappers = [NSMutableArray array];
  NSRegularExpression *pattern = [NSRegularExpression regularExpressionWithPattern:@"^discord_desktop_core-(\\d+)$" options:0 error:nil];
  for (NSString *name in entries) {
    NSTextCheckingResult *match = [pattern firstMatchInString:name options:0 range:NSMakeRange(0, name.length)];
    if (match == nil) continue;
    NSString *number = [name substringWithRange:[match rangeAtIndex:1]];
    [wrappers addObject:@{ @"name": name, @"number": @(number.integerValue) }];
  }
  [wrappers sortUsingComparator:^NSComparisonResult(NSDictionary *a, NSDictionary *b) {
    return [b[@"number"] compare:a[@"number"]];
  }];
  for (NSDictionary *wrapper in wrappers) {
    NSString *candidate = [[[modulesDir stringByAppendingPathComponent:wrapper[@"name"]]
      stringByAppendingPathComponent:@"discord_desktop_core"] stringByStandardizingPath];
    if (IsCoreDirectory(candidate)) return candidate;
  }
  NSString *legacy = [modulesDir stringByAppendingPathComponent:@"discord_desktop_core"];
  return IsCoreDirectory(legacy) ? legacy : nil;
}

static NSArray<NSString *> *ResolveAllCoreDirectories(NSString *baseDir, NSError **error) {
  NSError *readError = nil;
  NSArray<NSString *> *entries = [[NSFileManager defaultManager] contentsOfDirectoryAtPath:baseDir error:&readError];
  if (entries == nil) {
    if (error != NULL) *error = readError;
    return nil;
  }
  NSMutableArray<NSString *> *versions = [NSMutableArray array];
  for (NSString *name in entries) {
    if (VersionTuple(name) != nil) [versions addObject:name];
  }
  [versions sortUsingComparator:^NSComparisonResult(NSString *a, NSString *b) {
    return CompareVersionNames(a, b);
  }];
  NSMutableArray<NSString *> *cores = [NSMutableArray array];
  for (NSString *version in versions) {
    NSString *modules = [[baseDir stringByAppendingPathComponent:version] stringByAppendingPathComponent:@"modules"];
    NSString *core = CoreDirectory(modules);
    if (core != nil) [cores addObject:core];
  }
  return cores;
}

static NSString *NormalizeIndex(NSString *content) {
  NSString *trimmed = [content stringByTrimmingCharactersInSet:[NSCharacterSet whitespaceAndNewlineCharacterSet]];
  return trimmed.length > 0 ? [trimmed stringByAppendingString:@"\n"] : VanillaIndex;
}

static NSString *BaseIndex(NSString *content) {
  if ([content containsString:BlockStart]) {
    NSString *patternText = [NSString stringWithFormat:@"%@.*?%@\\n?",
      [NSRegularExpression escapedPatternForString:BlockStart],
      [NSRegularExpression escapedPatternForString:BlockEnd]];
    NSRegularExpression *pattern = [NSRegularExpression regularExpressionWithPattern:patternText
      options:NSRegularExpressionDotMatchesLineSeparators error:nil];
    NSString *stripped = [pattern stringByReplacingMatchesInString:content options:0
      range:NSMakeRange(0, content.length) withTemplate:@""];
    return NormalizeIndex(stripped);
  }
  if ([content containsString:LoaderMarker]) return VanillaIndex;
  return NormalizeIndex(content);
}

static NSString *LoaderBlock(void) {
  return [NSString stringWithFormat:@"%@\ntry {\n  require(\"./%@/main.js\").install();\n} catch (error) {\n  console.error(\"[Babel] Failed to install hook:\", error);\n}\n%@\n",
    BlockStart, PayloadDirName, BlockEnd];
}

static BOOL CopyItem(NSString *source, NSString *destination, NSError **error) {
  NSFileManager *fm = [NSFileManager defaultManager];
  if (![fm createDirectoryAtPath:[destination stringByDeletingLastPathComponent]
    withIntermediateDirectories:YES attributes:nil error:error]) return NO;
  return [fm copyItemAtPath:source toPath:destination error:error];
}

static BOOL CopyPayload(NSString *source, NSString *destination, NSError **error) {
  NSFileManager *fm = [NSFileManager defaultManager];
  NSString *temp = [[destination stringByDeletingLastPathComponent] stringByAppendingPathComponent:
    [NSString stringWithFormat:@".%@-%@", PayloadDirName, NSUUID.UUID.UUIDString]];
  [fm removeItemAtPath:temp error:nil];
  if (![fm createDirectoryAtPath:temp withIntermediateDirectories:YES attributes:nil error:error]) return NO;

  NSArray<NSString *> *modFiles = @[@"main.js", @"preload.js", @"renderer.js"];
  for (NSString *name in modFiles) {
    NSString *from = [[source stringByAppendingPathComponent:@"mod"] stringByAppendingPathComponent:name];
    if ([fm fileExistsAtPath:from] && !CopyItem(from, [temp stringByAppendingPathComponent:name], error)) {
      [fm removeItemAtPath:temp error:nil];
      return NO;
    }
  }
  NSString *shared = [source stringByAppendingPathComponent:@"shared"];
  if ([fm fileExistsAtPath:shared] && !CopyItem(shared, [temp stringByAppendingPathComponent:@"shared"], error)) {
    [fm removeItemAtPath:temp error:nil];
    return NO;
  }
  if (![fm fileExistsAtPath:[temp stringByAppendingPathComponent:@"main.js"]]) {
    [fm removeItemAtPath:temp error:nil];
    return Fail(error, @"The embedded Babel payload is incomplete.");
  }

  [fm removeItemAtPath:destination error:nil];
  if (![fm moveItemAtPath:temp toPath:destination error:error]) {
    [fm removeItemAtPath:temp error:nil];
    return NO;
  }
  return YES;
}

BOOL BabelInstall(NSString *discordBaseDir, NSString *payloadSource, NSError **error) {
  NSArray<NSString *> *cores = ResolveAllCoreDirectories(discordBaseDir, error);
  if (cores == nil) return NO;
  if (cores.count == 0) return Fail(error, [NSString stringWithFormat:@"No Discord desktop core was found under %@.", discordBaseDir]);

  NSString *core = cores.firstObject;
  NSFileManager *fm = [NSFileManager defaultManager];
  NSString *indexPath = [core stringByAppendingPathComponent:@"index.js"];
  NSString *backupPath = [core stringByAppendingPathComponent:BackupName];
  NSString *payloadDest = [core stringByAppendingPathComponent:PayloadDirName];
  NSString *current = [NSString stringWithContentsOfFile:indexPath encoding:NSUTF8StringEncoding error:nil] ?: VanillaIndex;
  BOOL legacy = [current containsString:LoaderMarker] && ![current containsString:BlockStart];
  NSString *sourceIndex = current;
  if (legacy && [fm fileExistsAtPath:backupPath]) {
    sourceIndex = [NSString stringWithContentsOfFile:backupPath encoding:NSUTF8StringEncoding error:nil] ?: current;
  }
  NSString *base = BaseIndex(sourceIndex);
  if (![base containsString:@"core.asar"]) {
    return Fail(error, [NSString stringWithFormat:@"Refusing to patch an unrecognized Discord core at %@.", indexPath]);
  }
  if (!CopyPayload(payloadSource, payloadDest, error)) return NO;
  NSString *patched = [LoaderBlock() stringByAppendingString:base];
  if (![patched writeToFile:indexPath atomically:YES encoding:NSUTF8StringEncoding error:error]) return NO;
  [fm removeItemAtPath:backupPath error:nil];
  return YES;
}

static BOOL RemoveItemIfPresent(NSString *path, NSError **error) {
  NSError *removeError = nil;
  if ([[NSFileManager defaultManager] removeItemAtPath:path error:&removeError]) return YES;
  if ([removeError.domain isEqualToString:NSCocoaErrorDomain] && removeError.code == NSFileNoSuchFileError) return YES;
  if (error != NULL) *error = removeError;
  return NO;
}

BOOL BabelUninstall(NSString *discordBaseDir, NSError **error) {
  NSArray<NSString *> *cores = ResolveAllCoreDirectories(discordBaseDir, error);
  if (cores == nil) return NO;
  NSFileManager *fm = [NSFileManager defaultManager];
  for (NSString *core in cores) {
    NSString *indexPath = [core stringByAppendingPathComponent:@"index.js"];
    NSString *backupPath = [core stringByAppendingPathComponent:BackupName];
    NSString *payloadDest = [core stringByAppendingPathComponent:PayloadDirName];
    NSString *current = [NSString stringWithContentsOfFile:indexPath encoding:NSUTF8StringEncoding error:nil] ?: @"";
    if ([current containsString:BlockStart]) {
      if (![BaseIndex(current) writeToFile:indexPath atomically:YES encoding:NSUTF8StringEncoding error:error]) return NO;
    } else if ([current containsString:LoaderMarker]) {
      if ([fm fileExistsAtPath:backupPath]) {
        if (!RemoveItemIfPresent(indexPath, error)) return NO;
        if (![fm copyItemAtPath:backupPath toPath:indexPath error:error]) return NO;
      } else if (![VanillaIndex writeToFile:indexPath atomically:YES encoding:NSUTF8StringEncoding error:error]) {
        return NO;
      }
    }
    if (!RemoveItemIfPresent(backupPath, error)) return NO;
    if (!RemoveItemIfPresent(payloadDest, error)) return NO;
  }
  return RemoveItemIfPresent([discordBaseDir stringByAppendingPathComponent:PayloadDirName], error);
}
