#import "BabelInstallerCore.h"
#import <CommonCrypto/CommonDigest.h>
#import <fcntl.h>
#import <libproc.h>
#import <sys/file.h>
#import <errno.h>
#import <sys/stat.h>
#import <unistd.h>

static NSString *const BabelErrorDomain = @"local.discord-translator-mod.installer";
static NSString *const LoaderMarker = @"DiscordTranslatorMod desktop-core loader";
static NSString *const BlockStart = @"/* DiscordTranslatorMod desktop-core loader:start */";
static NSString *const BlockEnd = @"/* DiscordTranslatorMod desktop-core loader:end */";
static NSString *const PayloadDirName = @"discord-translator-mod";
static NSString *const BackupName = @"index.js.dtm-original";
static NSString *const VanillaIndex = @"module.exports = require('./core.asar');\n";

static BOOL Fail(NSError **error, NSString *message) {
  if (error != NULL) {
    NSMutableDictionary *info=[@{NSLocalizedDescriptionKey:message,@"BabelMessageID":message} mutableCopy];
    if(*error)info[NSUnderlyingErrorKey]=*error;
    *error = [NSError errorWithDomain:BabelErrorDomain code:1 userInfo:info];
  }
  return NO;
}

static NSMutableDictionary *Rejected(NSError **error, NSString *message) {
  Fail(error, message);
  return nil;
}

static BOOL FailAt(NSError **error, NSString *messageID, NSString *path) {
  if(error)*error=[NSError errorWithDomain:BabelErrorDomain code:1 userInfo:@{NSLocalizedDescriptionKey:messageID,@"BabelMessageID":messageID,@"BabelMessageParams":@{@"path":path?:@""}}];
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

static NSString *BaseIndex(NSString *content) {
  if ([content containsString:BlockStart]) {
    NSString *patternText = [NSString stringWithFormat:@"%@.*?%@\\n?",
      [NSRegularExpression escapedPatternForString:BlockStart],
      [NSRegularExpression escapedPatternForString:BlockEnd]];
    NSRegularExpression *pattern = [NSRegularExpression regularExpressionWithPattern:patternText
      options:NSRegularExpressionDotMatchesLineSeparators error:nil];
    return [pattern stringByReplacingMatchesInString:content options:0
      range:NSMakeRange(0, content.length) withTemplate:@""];
  }
  if ([content containsString:LoaderMarker]) return VanillaIndex;
  return content;
}

static NSString *LoaderBlock(NSString *name) {
  return [NSString stringWithFormat:@"%@\ntry {\n  require(\"./%@/main.js\").install();\n} catch (error) {\n  console.error(\"[Babel] Failed to install hook:\", error);\n}\n%@\n",
    BlockStart, name, BlockEnd];
}

#if BABEL_INSTALL_TEST
static int babelTestActivity = 0;
static BOOL (*babelInstallHook)(NSString *step, NSString *path) = NULL;
void BabelSetTestActivity(int mode) { babelTestActivity = mode; }
void BabelSetInstallHook(BOOL (*hook)(NSString *step, NSString *path)) { babelInstallHook = hook; }
static BOOL RunHook(NSString *step, NSString *path, NSError **error) {
  if (babelInstallHook && !babelInstallHook(step, path)) return Fail(error, @"common.error.operation");
  return YES;
}
#else
static BOOL RunHook(NSString *step, NSString *path, NSError **error) {
  (void)step; (void)path; (void)error; return YES;
}
#endif

static NSString *RandomHex(void) {
  uint8_t bytes[8];
  arc4random_buf(bytes, sizeof(bytes));
  NSMutableString *hex = [NSMutableString stringWithCapacity:16];
  for (NSUInteger i = 0; i < sizeof(bytes); i++) [hex appendFormat:@"%02x", bytes[i]];
  return hex;
}

// Directory fsync is best-effort. Some volumes reject it, and that is not an
// activation failure. A regular payload or candidate file must be flushed.
static void FsyncDirectory(NSString *path) {
  int fd = open(path.fileSystemRepresentation, O_RDONLY);
  if (fd >= 0) { fsync(fd); close(fd); }
}

static BOOL FsyncRegular(NSString *path, NSError **error) {
  struct stat info;
  if (lstat(path.fileSystemRepresentation, &info) != 0 || !S_ISREG(info.st_mode)) return Fail(error, @"common.error.operation");
  int fd = open(path.fileSystemRepresentation, O_RDONLY);
  if (fd < 0) return Fail(error, @"common.error.operation");
  int result = fsync(fd);
  int saved = errno;
  close(fd);
  if (result != 0) {
    errno = saved;
    return Fail(error, @"common.error.operation");
  }
  return YES;
}

static BOOL RegularFile(NSString *path) {
  NSNumber *link = nil, *regular = nil;
  NSURL *url = [NSURL fileURLWithPath:path];
  if (![url getResourceValue:&link forKey:NSURLIsSymbolicLinkKey error:nil] || link.boolValue) return NO;
  if (![url getResourceValue:&regular forKey:NSURLIsRegularFileKey error:nil] || !regular.boolValue) return NO;
  return YES;
}

static BOOL CoreReady(NSString *core, NSError **error) {
  for (NSString *name in @[@"index.js", @"core.asar", @"package.json"]) {
    NSString *path = [core stringByAppendingPathComponent:name];
    NSDictionary *attributes = [NSFileManager.defaultManager attributesOfItemAtPath:path error:nil];
    if (!RegularFile(path) || attributes.fileSize == 0) return Fail(error, @"common.error.coreIncomplete");
  }
  return YES;
}

static BOOL NameMatches(NSString *name, NSString *pattern) {
  NSRegularExpression *expression = [NSRegularExpression regularExpressionWithPattern:pattern options:0 error:nil];
  NSTextCheckingResult *match = [expression firstMatchInString:name options:0 range:NSMakeRange(0, name.length)];
  return match != nil && match.range.location == 0 && match.range.length == name.length;
}

static NSString *ReferencedPayload(NSString *indexText) {
  if (indexText.length == 0) return nil;
  NSString *scope = @"";
  if ([indexText containsString:BlockStart]) {
    NSString *patternText = [NSString stringWithFormat:@"%@.*?%@\\n?",
      [NSRegularExpression escapedPatternForString:BlockStart],
      [NSRegularExpression escapedPatternForString:BlockEnd]];
    NSRegularExpression *pattern = [NSRegularExpression regularExpressionWithPattern:patternText options:NSRegularExpressionDotMatchesLineSeparators error:nil];
    NSMutableString *joined = [NSMutableString string];
    for (NSTextCheckingResult *match in [pattern matchesInString:indexText options:0 range:NSMakeRange(0, indexText.length)])
      [joined appendString:[indexText substringWithRange:match.range]];
    scope = joined;
  } else if ([indexText containsString:LoaderMarker]) scope = indexText;
  NSRegularExpression *reference = [NSRegularExpression regularExpressionWithPattern:@"require\\(\\s*['\"]\\./(discord-translator-mod(?:-g-[nd]-[0-9]+-[0-9a-f]{16})?)/main(?:\\.js)?['\"]\\s*\\)" options:0 error:nil];
  NSTextCheckingResult *match = [reference firstMatchInString:scope options:0 range:NSMakeRange(0, scope.length)];
  return match ? [scope substringWithRange:[match rangeAtIndex:1]] : nil;
}

static NSString *ManifestIdentity(NSDictionary *manifest) {
  if (![manifest isKindOfClass:NSDictionary.class] || ![manifest[@"files"] isKindOfClass:NSArray.class]) return nil;
  NSMutableArray<NSString *> *rows = [NSMutableArray array];
  for (id entry in manifest[@"files"]) {
    if (![entry isKindOfClass:NSDictionary.class]) return nil;
    [rows addObject:[NSString stringWithFormat:@"%@\n%@\n%@", entry[@"path"], entry[@"bytes"], entry[@"sha256"]]];
  }
  [rows sortUsingSelector:@selector(compare:)];
  return [NSString stringWithFormat:@"%@\n%@", manifest[@"version"], [rows componentsJoinedByString:@"\n"]];
}

// Each channel folder maps to its application name and, where an installed
// Info.plist has verified it, the owning bundle identifier. A channel without a
// verified identifier is never guessed; its manual restart instructions stay.
static NSArray<NSDictionary *> *BabelChannels(void) {
  return @[
    @{ @"dir": @"discord", @"app": @"Discord", @"bundleID": @"com.hnc.Discord" },
    @{ @"dir": @"discordptb", @"app": @"Discord PTB" },
    @{ @"dir": @"discordcanary", @"app": @"Discord Canary" },
    @{ @"dir": @"discorddevelopment", @"app": @"Discord Development" },
  ];
}

static NSString *ChannelValue(NSString *resolved, NSString *home, NSString *key) {
  for (NSDictionary *channel in BabelChannels()) {
    NSString *folder = [[home stringByAppendingPathComponent:
      [@"Library/Application Support/" stringByAppendingString:channel[@"dir"]]] stringByResolvingSymlinksInPath];
    if ([resolved isEqualToString:folder]) return channel[key];
  }
  return nil;
}

NSString *BabelChannelBundleIDForHome(NSString *base, NSString *home) {
  return ChannelValue(base.stringByResolvingSymlinksInPath, home, @"bundleID");
}

NSString *BabelChannelBundleID(NSString *base) {
  return BabelChannelBundleIDForHome(base, NSHomeDirectory());
}

static void DiscordActivity(NSString *base, BOOL *known, BOOL *running) {
  *known = NO; *running = NO;
#if BABEL_INSTALL_TEST
  if (babelTestActivity == 1) { *known = YES; return; }
  if (babelTestActivity == 2) { *known = YES; *running = YES; return; }
  if (babelTestActivity == 3) return;
#endif
  NSString *resolved = base.stringByResolvingSymlinksInPath;
  NSString *app = ChannelValue(resolved, NSHomeDirectory(), @"app");
  if (!app) return;
  *known = YES;
  // proc_listallpids returns a pid count. Its buffer argument is a byte size.
  int count = proc_listallpids(NULL, 0);
  if (count <= 0) { *running = YES; return; }
  int capacity = count + 64;
  pid_t *pids = calloc((size_t)capacity, sizeof(pid_t));
  if (!pids) { *running = YES; return; }
  int got = proc_listallpids(pids, capacity * (int)sizeof(pid_t));
  if (got <= 0 || got >= capacity) { free(pids); *running = YES; return; }
  NSString *needle = [NSString stringWithFormat:@"/%@.app/", app];
  for (int i = 0; i < got; i++) {
    char path[4096];
    int length = proc_pidpath(pids[i], path, sizeof(path));
    if (length <= 0) continue;
    NSString *text = [[NSString alloc] initWithBytes:path length:(NSUInteger)length encoding:NSUTF8StringEncoding];
    if ([text.lastPathComponent isEqualToString:app] || [text containsString:needle]) { *running = YES; break; }
  }
  free(pids);
}

static BOOL AcquireLock(NSString *base, int *fd, NSError **error) {
  NSString *path = [base stringByAppendingPathComponent:@".discord-translator-mod.lock"];
  int opened = open(path.fileSystemRepresentation, O_CREAT | O_RDWR, 0600);
  if (opened < 0) return Fail(error, @"common.error.operation");
  if (flock(opened, LOCK_EX | LOCK_NB) != 0) { close(opened); return Fail(error, @"common.error.targetLocked"); }
  *fd = opened;
  return YES;
}

static NSMutableDictionary<NSString *, NSData *> *LoadVerified(NSString *source, NSError **error) {
  NSData *manifestData=[NSData dataWithContentsOfFile:[source stringByAppendingPathComponent:@"manifest.json"]];
  if(!manifestData||manifestData.length>256*1024)return Rejected(error,@"common.error.manifest");
  NSDictionary *manifest=[NSJSONSerialization JSONObjectWithData:manifestData options:0 error:error];
  if(![manifest isKindOfClass:NSDictionary.class]||![manifest[@"version"] isKindOfClass:NSString.class]||![manifest[@"files"] isKindOfClass:NSArray.class])return Rejected(error,@"common.error.manifest");
  NSMutableDictionary<NSString *,NSData *> *contents=[NSMutableDictionary dictionary];
  for(NSDictionary *entry in manifest[@"files"]) {
    if(![entry isKindOfClass:NSDictionary.class])return Rejected(error,@"common.error.manifest");
    NSString *name=entry[@"path"];
    if(![name isKindOfClass:NSString.class]||name.length==0||name.isAbsolutePath||[name containsString:@"\\"]||[name containsString:@":"]||contents[name])return Rejected(error,@"common.error.payloadUnsafe");
    for(NSString *part in [name componentsSeparatedByString:@"/"])if(part.length==0||[part isEqualToString:@".."]||[part isEqualToString:@"."])return Rejected(error,@"common.error.payloadUnsafe");
    NSString *from=[source stringByAppendingPathComponent:name];
    if(![[from stringByResolvingSymlinksInPath] isEqualToString:[[source stringByResolvingSymlinksInPath] stringByAppendingPathComponent:name]])return Rejected(error,@"common.error.payloadUnsafe");
    NSData *data=[NSData dataWithContentsOfFile:from options:0 error:error];
    if(![entry[@"bytes"] isKindOfClass:NSNumber.class]||!data||data.length!=[entry[@"bytes"] unsignedIntegerValue]||data.length>4*1024*1024)return Rejected(error,@"common.error.payloadIntegrity");
    unsigned char hash[CC_SHA256_DIGEST_LENGTH];CC_SHA256(data.bytes,(CC_LONG)data.length,hash);NSMutableString *hex=[NSMutableString string];
    for(NSUInteger i=0;i<CC_SHA256_DIGEST_LENGTH;i++)[hex appendFormat:@"%02x",hash[i]];
    if(![hex isEqualToString:entry[@"sha256"]])return Rejected(error,@"common.error.payloadIntegrity");contents[name]=data;
  }
  for(NSString *required in @[@"main.js",@"preload.js",@"renderer.js",@"shared/settings.js",@"shared/defaults.js"])if(!contents[required])return Rejected(error,@"common.error.payloadIncomplete");
  NSRegularExpression *imports=[NSRegularExpression regularExpressionWithPattern:@"require\\([\"'](\\.[^\"']+)[\"']\\)" options:0 error:nil];
  for(NSString *name in contents) {
    NSString *text=[[NSString alloc]initWithData:contents[name] encoding:NSUTF8StringEncoding];if(!text||[text containsString:@"@dtm-test-only"])return Rejected(error,@"common.error.payloadIncomplete");
    for(NSTextCheckingResult *match in [imports matchesInString:text options:0 range:NSMakeRange(0,text.length)]) {
      NSString *relative=[text substringWithRange:[match rangeAtIndex:1]];
      NSMutableArray *parts=[NSMutableArray array];NSString *combined=[[name stringByDeletingLastPathComponent] stringByAppendingPathComponent:relative];
      for(NSString *part in [combined componentsSeparatedByString:@"/"]) {if(part.length==0||[part isEqualToString:@"."])continue;if([part isEqualToString:@".."]&&parts.count&&![[parts lastObject] isEqualToString:@".."]) [parts removeLastObject];else [parts addObject:part];}
      NSString *imported=[parts componentsJoinedByString:@"/"];
      if(![imported hasSuffix:@".js"])imported=[imported stringByAppendingString:@".js"];
      if([imported hasPrefix:@"../shared/"])imported=[imported substringFromIndex:3];if(!contents[imported])return Rejected(error,@"common.error.payloadIncomplete");
    }
  }
  NSString *defaults=[[NSString alloc]initWithData:contents[@"shared/defaults.js"] encoding:NSUTF8StringEncoding];
  NSRegularExpression *versionPattern=[NSRegularExpression regularExpressionWithPattern:@"const BABEL_VERSION\\s*=\\s*[\"']([^\"']+)[\"']" options:0 error:nil];NSTextCheckingResult *versionMatch=[versionPattern firstMatchInString:defaults options:0 range:NSMakeRange(0,defaults.length)];
  NSString *version=versionMatch?[defaults substringWithRange:[versionMatch rangeAtIndex:1]]:nil,*bundleVersion=[NSBundle.mainBundle objectForInfoDictionaryKey:@"CFBundleShortVersionString"];
  if(![version isEqualToString:manifest[@"version"]]||(bundleVersion&&![bundleVersion isEqualToString:version]))return Rejected(error,@"common.error.version");
  contents[@"manifest.json"]=manifestData;
  return contents;
}

static BOOL RemoveItemIfPresent(NSString *path, NSError **error) {
  NSError *removeError = nil;
  if ([[NSFileManager defaultManager] removeItemAtPath:path error:&removeError]) return YES;
  if ([removeError.domain isEqualToString:NSCocoaErrorDomain] && removeError.code == NSFileNoSuchFileError) return YES;
  if (error != NULL) *error = removeError;
  return NO;
}

// 0 missing, 1 regular file, 2 something else, -1 unreadable.
static int EntryKind(NSString *path) {
  struct stat info;
  if (lstat(path.fileSystemRepresentation, &info) != 0) return errno == ENOENT ? 0 : -1;
  return S_ISREG(info.st_mode) && !S_ISLNK(info.st_mode) ? 1 : 2;
}

static NSString *IdentityForContents(NSDictionary<NSString *, NSData *> *contents) {
  NSData *data = contents[@"manifest.json"];
  if (!data) return nil;
  id parsed = [NSJSONSerialization JSONObjectWithData:data options:0 error:nil];
  return ManifestIdentity(parsed);
}

static BOOL NativeOwned(NSString *name) {
  return [name isEqualToString:PayloadDirName]
    || NameMatches(name, @"^discord-translator-mod-g-n-[0-9]+-[0-9a-f]{16}$")
    || NameMatches(name, @"^\\.discord-translator-mod-s-n-[0-9a-f]{16}$")
    || NameMatches(name, @"^\\.discord-translator-mod-i-n-[0-9a-f]{16}$");
}

static BOOL OwnedPayload(NSString *name) {
  return [name isEqualToString:PayloadDirName]
    || NameMatches(name, @"^discord-translator-mod-g-[nd]-[0-9]+-[0-9a-f]{16}$")
    || NameMatches(name, @"^\\.discord-translator-mod-s-[nd]-[0-9a-f]{16}$");
}

static BOOL DeveloperOwned(NSString *name) {
  return NameMatches(name, @"^(?:discord-translator-mod-g-d-[0-9]+-[0-9a-f]{16}|\\.discord-translator-mod-[si]-d-[0-9a-f]{16})$");
}

static BOOL RemoveContained(NSString *parent, NSString *child, NSError **error) {
  if (EntryKind(child) == 2) {
    struct stat info;
    if (lstat(child.fileSystemRepresentation, &info) == 0 && S_ISLNK(info.st_mode))
      return Fail(error, @"common.error.payloadUnsafe");
  }
  NSString *prefix = [parent.stringByStandardizingPath stringByAppendingString:@"/"];
  if (![child.stringByStandardizingPath hasPrefix:prefix]) return Fail(error, @"common.error.payloadUnsafe");
  return RemoveItemIfPresent(child, error);
}

static BOOL ReplaceFile(NSString *temp, NSString *target, NSError **error) {
  NSError *replaceError = nil;
  BOOL ok = [NSFileManager.defaultManager replaceItemAtURL:[NSURL fileURLWithPath:target]
    withItemAtURL:[NSURL fileURLWithPath:temp] backupItemName:nil options:0 resultingItemURL:nil error:&replaceError];
  if (!ok) {
    [NSFileManager.defaultManager removeItemAtPath:temp error:nil];
    if (error) *error = replaceError;
  }
  return ok;
}

static BOOL LeadingUTF8BOM(NSData *data) {
  const unsigned char *bytes = data.bytes;
  return data.length >= 3 && bytes[0] == 0xEF && bytes[1] == 0xBB && bytes[2] == 0xBF;
}

// stringWithContentsOfFile:encoding: drops a leading UTF-8 BOM. Keep that
// signature as U+FEFF so the UTF-8 write emits the original EF BB BF bytes.
static NSString *IndexText(NSData *data, NSError **error) {
  if (!data) return nil;
  NSUInteger start = LeadingUTF8BOM(data) ? 3 : 0;
  const unsigned char *bytes = data.bytes;
  NSString *text = [[NSString alloc] initWithBytes:bytes + start length:data.length - start encoding:NSUTF8StringEncoding];
  if (!text) {
    Fail(error, @"common.error.operation");
    return nil;
  }
  return start ? [@"\uFEFF" stringByAppendingString:text] : text;
}

static NSString *PreservedBase(NSString *core, NSString *current, NSError **error) {
  BOOL legacy = [current containsString:LoaderMarker] && ![current containsString:BlockStart];
  NSString *visible = [current hasPrefix:@"\uFEFF"] ? [current substringFromIndex:1] : current;
  if (!legacy && [[visible stringByTrimmingCharactersInSet:[NSCharacterSet whitespaceAndNewlineCharacterSet]] length] == 0) {
    Fail(error, @"common.error.coreIncomplete");
    return nil;
  }
  NSString *source = current;
  if (legacy) {
    NSString *backup = [core stringByAppendingPathComponent:BackupName];
    int kind = EntryKind(backup);
    if (kind < 0) { Fail(error, @"common.error.operation"); return nil; }
    if (kind == 2) { Fail(error, @"common.error.coreIncomplete"); return nil; }
    if (kind == 1) {
      NSData *backupBytes = [NSData dataWithContentsOfFile:backup options:0 error:error];
      source = IndexText(backupBytes, error);
      if (!source) {
        if (error && !*error) Fail(error, @"common.error.operation");
        return nil;
      }
    }
  }
  return BaseIndex(source);
}

static BOOL RemoveRegularBackup(NSString *core, NSError **error) {
  NSString *backup = [core stringByAppendingPathComponent:BackupName];
  if (EntryKind(backup) != 1) return YES;
  return RemoveItemIfPresent(backup, error);
}

static BOOL CommitIndex(NSString *indexPath, NSString *contents, NSData *snapshot, NSError **error) {
  NSString *temp = [[indexPath stringByDeletingLastPathComponent] stringByAppendingPathComponent:[NSString stringWithFormat:@".discord-translator-mod-i-n-%@", RandomHex()]];
  NSError *writeError = nil;
  NSData *encoded = [contents dataUsingEncoding:NSUTF8StringEncoding];
  if (!encoded || ![encoded writeToFile:temp options:0 error:&writeError]) {
    [[NSFileManager defaultManager] removeItemAtPath:temp error:nil];
    if (error) *error = writeError;
    return NO;
  }
  if (!FsyncRegular(temp, &writeError)) {
    [[NSFileManager defaultManager] removeItemAtPath:temp error:nil];
    if (error) *error = writeError;
    return NO;
  }
  NSData *again = [NSData dataWithContentsOfFile:indexPath options:0 error:&writeError];
  if (!again || ![again isEqualToData:snapshot]) {
    [[NSFileManager defaultManager] removeItemAtPath:temp error:nil];
    if (!again) { if (error) *error = writeError; return NO; }
    return Fail(error, @"common.error.targetChanged");
  }
  if (!RunHook(@"commit", indexPath, error)) {
    [[NSFileManager defaultManager] removeItemAtPath:temp error:nil];
    return NO;
  }
  if (!ReplaceFile(temp, indexPath, error)) return NO;
  FsyncDirectory(indexPath.stringByDeletingLastPathComponent);
  [NSString stringWithContentsOfFile:indexPath encoding:NSUTF8StringEncoding error:nil];
  return YES;
}

static NSString *PublishGeneration(NSString *core, NSDictionary<NSString *, NSData *> *contents, NSError **error) {
  NSFileManager *fm = [NSFileManager defaultManager];
  NSString *stage = [core stringByAppendingPathComponent:[NSString stringWithFormat:@".discord-translator-mod-s-n-%@", RandomHex()]];
  if (![fm createDirectoryAtPath:stage withIntermediateDirectories:NO attributes:nil error:error]) return nil;
  BOOL published = NO;
  @try {
    for (NSString *name in contents) {
      NSString *target = [stage stringByAppendingPathComponent:name];
      if (![fm createDirectoryAtPath:target.stringByDeletingLastPathComponent withIntermediateDirectories:YES attributes:nil error:error]) return nil;
      if (![contents[name] writeToFile:target options:0 error:error]) return nil;
      if (!FsyncRegular(target, error)) return nil;
    }
    FsyncDirectory(stage);
    NSMutableDictionary *staged = LoadVerified(stage, error);
    if (!staged || ![IdentityForContents(staged) isEqualToString:IdentityForContents(contents)]) {
      Fail(error, @"common.error.payloadIntegrity");
      return nil;
    }
    if (!RunHook(@"stage", stage, error) || !RunHook(@"publish", stage, error)) return nil;
    long long stamp = (long long)(NSDate.date.timeIntervalSince1970 * 1000.0);
    NSString *name = [NSString stringWithFormat:@"discord-translator-mod-g-n-%lld-%@", stamp, RandomHex()];
    if (![fm moveItemAtPath:stage toPath:[core stringByAppendingPathComponent:name] error:error]) return nil;
    published = YES;
    FsyncDirectory(core);
    return name;
  } @finally {
    if (!published) [fm removeItemAtPath:stage error:nil];
  }
}

static BOOL CleanupNative(NSString *core, NSError **error) {
  NSArray<NSString *> *entries = [[NSFileManager defaultManager] contentsOfDirectoryAtPath:core error:error];
  if (!entries) return NO;
  NSError *first = nil;
  for (NSString *name in entries) {
    if (!NativeOwned(name)) continue;
    NSError *readError = nil;
    NSString *text = [NSString stringWithContentsOfFile:[core stringByAppendingPathComponent:@"index.js"] encoding:NSUTF8StringEncoding error:&readError];
    if (!text) { if (!first) first = readError; continue; }
    if ([ReferencedPayload(text) isEqualToString:name]) continue;
    NSError *removeError = nil;
    if (!RemoveContained(core, [core stringByAppendingPathComponent:name], &removeError) && !first) first = removeError;
  }
  if (first) { if (error) *error = first; return NO; }
  return YES;
}

static BOOL CleanupIfIdle(NSString *base, NSString *core, NSError **error) {
  BOOL known = NO, running = NO;
  DiscordActivity(base, &known, &running);
  if (!known || running) return YES;
  return CleanupNative(core, error);
}

static BOOL FinishInstalled(NSString *base, NSString *core, NSError **error) {
  NSError *cause = nil;
  NSString *detailID = nil;
  if (!RemoveRegularBackup(core, &cause)) detailID = @"common.detail.previousFileKept";
  else if (!CleanupIfIdle(base, core, &cause)) detailID = @"common.detail.payloadKept";
  if (!detailID) return YES;
  if (error) {
    NSMutableDictionary *info = [@{NSLocalizedDescriptionKey: detailID, @"BabelMessageID": detailID} mutableCopy];
    if (cause) info[NSUnderlyingErrorKey] = cause;
    *error = [NSError errorWithDomain:BabelErrorDomain code:1 userInfo:info];
  }
  return YES;
}

BOOL BabelInstall(NSString *discordBaseDir, NSString *payloadSource, NSError **error) {
  int fd = -1;
  if (!AcquireLock(discordBaseDir, &fd, error)) return NO;
  @try {
    NSArray<NSString *> *cores = ResolveAllCoreDirectories(discordBaseDir, error);
    if (cores == nil) return NO;
    if (cores.count == 0) return Fail(error, @"common.error.coreMissing");
    NSString *core = cores.firstObject;
    if (!CoreReady(core, error)) return NO;
    NSString *indexPath = [core stringByAppendingPathComponent:@"index.js"];
    NSError *readError = nil;
    NSData *currentBytes = [NSData dataWithContentsOfFile:indexPath options:0 error:&readError];
    NSString *current = IndexText(currentBytes, &readError);
    if (!current) {
      if (error) *error = readError ?: [NSError errorWithDomain:BabelErrorDomain code:1 userInfo:@{NSLocalizedDescriptionKey: @"common.error.operation", @"BabelMessageID": @"common.error.operation"}];
      return NO;
    }
    NSString *base = PreservedBase(core, current, error);
    if (!base) return NO;
    if (![base containsString:@"core.asar"]) return FailAt(error, @"common.error.unrecognized", indexPath);
    NSMutableDictionary *requested = LoadVerified(payloadSource, error);
    if (!requested) return NO;
    NSString *want = IdentityForContents(requested);
    NSString *referenced = ReferencedPayload(current);
    BOOL legacy = [current containsString:LoaderMarker] && ![current containsString:BlockStart];
    NSString *generation = nil;
    if (referenced.length && !legacy) {
      NSMutableDictionary *have = LoadVerified([core stringByAppendingPathComponent:referenced], NULL);
      if (have && [IdentityForContents(have) isEqualToString:want]) {
        return FinishInstalled(discordBaseDir, core, error);
      }
    } else if (referenced.length) {
      NSMutableDictionary *have = LoadVerified([core stringByAppendingPathComponent:referenced], NULL);
      if (have && [IdentityForContents(have) isEqualToString:want]) generation = referenced;
    }
    if (!generation) {
      generation = PublishGeneration(core, requested, error);
      if (!generation) return NO;
    }
    NSData *again = [NSData dataWithContentsOfFile:indexPath options:0 error:&readError];
    if (!again) { if (error) *error = readError; return NO; }
    if (![again isEqualToData:currentBytes]) return Fail(error, @"common.error.targetChanged");
    if (!RunHook(@"beforeCommit", indexPath, error)) return NO;
    NSData *hooked = [NSData dataWithContentsOfFile:indexPath options:0 error:&readError];
    if (!hooked) { if (error) *error = readError; return NO; }
    if (![hooked isEqualToData:currentBytes]) return Fail(error, @"common.error.targetChanged");
    if (!CommitIndex(indexPath, [LoaderBlock(generation) stringByAppendingString:base], currentBytes, error)) return NO;
    return FinishInstalled(discordBaseDir, core, error);
  } @finally {
    if (fd >= 0) close(fd);
  }
}

BOOL BabelTargetValid(NSString *base, NSError **error) {
  NSArray *cores=ResolveAllCoreDirectories(base,error);
  if(!cores)return NO;if(cores.count==0)return Fail(error,@"common.error.coreMissing");return YES;
}
NSString *BabelProfileState(NSString *base) {
  NSString *store=[base stringByAppendingPathComponent:PayloadDirName];
  NSNumber *symlink=nil;NSURL *url=[NSURL fileURLWithPath:store];[url getResourceValue:&symlink forKey:NSURLIsSymbolicLinkKey error:nil];
  if (symlink.boolValue) return @"Unknown";
  BOOL directory=NO;BOOL exists=[[NSFileManager defaultManager] fileExistsAtPath:store isDirectory:&directory];
  if (exists&&!directory) return @"Unknown";
  return exists?@"Known":@"KnownAbsent";
}
static void AddStep(NSMutableArray *steps,NSString *path,NSString *action,NSString *state,NSString *detailID,NSError *systemError) {
  NSDictionary *actions=@{@"detach":@"common.step.detach",@"remove backup":@"common.step.backup",@"remove payload":@"common.step.payload",@"profile data":@"common.step.profile"};
  NSDictionary *states=@{@"done":@"common.state.done",@"already absent":@"common.state.absent",@"failed":@"common.state.failed",@"not attempted":@"common.state.skipped",@"kept":@"common.state.kept"};
  NSMutableDictionary *step=[@{@"path":path?:@"",@"action":action,@"state":state,@"actionID":actions[action]?:@"common.unavailable",@"stateID":states[state]?:@"common.unavailable",@"detail":detailID?:@"",@"detailID":detailID?:@""} mutableCopy];
  if(systemError) {
    step[@"systemError"]=systemError.localizedDescription;
    step[@"systemErrorDomain"]=systemError.domain;
    step[@"systemErrorCode"]=@(systemError.code);
  }
  [steps addObject:step];
}
BOOL BabelUninstallWithOptions(NSString *base, BOOL removeData, NSString *profile, NSMutableArray *steps, NSError **error) {
  int fd = -1;
  if (!AcquireLock(base, &fd, error)) return NO;
  @try {
    NSString *store = [base stringByAppendingPathComponent:PayloadDirName];
    if (removeData && (![[base stringByResolvingSymlinksInPath] isEqualToString:[profile stringByResolvingSymlinksInPath]] || [BabelProfileState(base) isEqualToString:@"Unknown"]))
      return Fail(error, @"common.error.profileUnsafe");
    NSArray *cores = ResolveAllCoreDirectories(base, error);
    if (cores == nil) return NO;
    BOOL known = NO, running = NO;
    DiscordActivity(base, &known, &running);
    NSFileManager *fm = NSFileManager.defaultManager;
    NSError *firstError = nil;
    for (NSString *core in cores) {
      NSString *index = [core stringByAppendingPathComponent:@"index.js"];
      NSString *backup = [core stringByAppendingPathComponent:BackupName];
      NSString *legacy = [core stringByAppendingPathComponent:PayloadDirName];
      NSError *stepError = nil;
      NSData *currentBytes = [NSData dataWithContentsOfFile:index options:0 error:&stepError];
      BOOL missing = !currentBytes && [stepError.domain isEqualToString:NSCocoaErrorDomain] && stepError.code == NSFileReadNoSuchFileError;
      NSString *current = IndexText(currentBytes, &stepError);
      BOOL detached = YES;
      NSString *restored = nil;
      if (!current && !missing) detached = NO;
      else if (current && [current containsString:BlockStart]) restored = BaseIndex(current);
      else if (current && [current containsString:LoaderMarker]) {
        int kind = EntryKind(backup);
        if (kind < 0) detached = NO;
        else if (kind == 2) {
          detached = NO;
          stepError = [NSError errorWithDomain:BabelErrorDomain code:1 userInfo:@{NSLocalizedDescriptionKey: @"common.error.coreIncomplete", @"BabelMessageID": @"common.error.coreIncomplete"}];
        } else if (kind == 1) {
          NSData *backupBytes = [NSData dataWithContentsOfFile:backup options:0 error:&stepError];
          restored = IndexText(backupBytes, &stepError);
          if (!restored) detached = NO;
        } else restored = VanillaIndex;
      }
      if (detached && restored && !CommitIndex(index, restored, currentBytes, &stepError)) detached = NO;
      BOOL hadMarker = current && [current containsString:LoaderMarker];
      AddStep(steps, index, @"detach", detached ? (hadMarker ? @"done" : @"already absent") : @"failed", nil, detached ? nil : stepError);
      if (!detached) {
        if (!stepError) stepError = [NSError errorWithDomain:BabelErrorDomain code:1 userInfo:@{NSLocalizedDescriptionKey: @"common.error.operation", @"BabelMessageID": @"common.error.operation"}];
        if (!firstError) firstError = stepError;
        AddStep(steps, backup, @"remove backup", @"not attempted", @"common.detail.backupRetained", nil);
        AddStep(steps, legacy, @"remove payload", @"not attempted", @"common.detail.payloadRetained", nil);
        continue;
      }
      int backupKind = EntryKind(backup);
      if (backupKind == 0) AddStep(steps, backup, @"remove backup", @"already absent", nil, nil);
      else if (backupKind != 1) {
        stepError = [NSError errorWithDomain:BabelErrorDomain code:1 userInfo:@{NSLocalizedDescriptionKey: @"common.error.coreIncomplete", @"BabelMessageID": @"common.error.coreIncomplete"}];
        AddStep(steps, backup, @"remove backup", @"failed", nil, stepError);
        if (!firstError) firstError = stepError;
      } else {
        stepError = nil;
        BOOL ok = RemoveItemIfPresent(backup, &stepError);
        AddStep(steps, backup, @"remove backup", ok ? @"done" : @"failed", nil, ok ? nil : stepError);
        if (!ok && !firstError) firstError = stepError;
      }
      NSString *detail = @"common.detail.payloadKept";
      if (known && running) detail = @"common.detail.discordRunning";
      else if (!known) detail = @"common.detail.identityUnresolved";
      NSInteger retained = 0;
      for (NSString *name in [fm contentsOfDirectoryAtPath:core error:nil] ?: @[]) {
        NSString *full = [core stringByAppendingPathComponent:name];
        if (known && !running && NativeOwned(name)) {
          NSError *readError = nil;
          NSString *text = [NSString stringWithContentsOfFile:index encoding:NSUTF8StringEncoding error:&readError];
          if (!text) {
            AddStep(steps, full, @"remove payload", @"kept", @"common.detail.payloadKept", readError);
            if (!firstError) firstError = readError;
            retained += 1;
            continue;
          }
          if ([ReferencedPayload(text) isEqualToString:name]) {
            AddStep(steps, full, @"remove payload", @"kept", @"common.detail.payloadKept", nil);
            retained += 1;
            continue;
          }
          stepError = nil;
          BOOL existed = EntryKind(full) != 0;
          BOOL ok = RemoveContained(core, full, &stepError);
          AddStep(steps, full, @"remove payload", ok ? (existed ? @"done" : @"already absent") : @"failed", nil, ok ? nil : stepError);
          if (!ok && !firstError) firstError = stepError;
          continue;
        }
        if (OwnedPayload(name) || DeveloperOwned(name)) {
          AddStep(steps, full, @"remove payload", @"kept", detail, nil);
          retained += 1;
        }
      }
      if (retained == 0 && !(known && !running)) AddStep(steps, legacy, @"remove payload", @"already absent", nil, nil);
    }
    if (!removeData || firstError) AddStep(steps, store, @"profile data", @"kept", firstError ? @"common.detail.incomplete" : @"common.detail.kept", nil);
    else if (!known) AddStep(steps, store, @"profile data", @"kept", @"common.detail.identityUnresolved", nil);
    else if (running) AddStep(steps, store, @"profile data", @"kept", @"common.detail.discordRunning", nil);
    else if ([BabelProfileState(base) isEqualToString:@"Unknown"]) {
      AddStep(steps, store, @"profile data", @"kept", @"common.detail.identityChanged", nil);
      Fail(&firstError, @"common.error.identityChanged");
    } else {
      NSError *stepError = nil;
      BOOL existed = EntryKind(store) != 0;
      BOOL ok = RemoveItemIfPresent(store, &stepError);
      AddStep(steps, store, @"profile data", ok ? (existed ? @"done" : @"already absent") : @"failed", nil, ok ? nil : stepError);
      if (!ok) firstError = stepError;
    }
    if (firstError) { if (error) *error = firstError; return NO; }
    return YES;
  } @finally {
    if (fd >= 0) close(fd);
  }
}
BOOL BabelUninstall(NSString *base,NSError **error) {return BabelUninstallWithOptions(base,NO,base,[NSMutableArray array],error);}
