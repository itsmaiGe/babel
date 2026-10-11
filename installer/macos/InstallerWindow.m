#import <Cocoa/Cocoa.h>
#import "BabelInstallerCore.h"

// AppKit chooses the bundle localization; no custom OS locale resolver is used.
static NSString *Localized(NSString *key) {
  NSString *value = [NSBundle.mainBundle localizedStringForKey:key value:@"" table:nil];
  if (value.length && ![value isEqualToString:key]) return value;
  NSBundle *english = [NSBundle bundleWithPath:[NSBundle.mainBundle.resourcePath stringByAppendingPathComponent:@"en.lproj"]];
  value = [english localizedStringForKey:key value:@"" table:nil];
  return value.length && ![value isEqualToString:key] ? value : nil;
}
static NSString *L(NSString *key, NSDictionary *params) {
  NSString *terminal = Localized(@"common.unavailable") ?: @"Unavailable", *value = Localized(key);
  if (!value) return terminal;
  NSRegularExpression *pattern = [NSRegularExpression regularExpressionWithPattern:@"\\{([A-Za-z][\\w]*)\\}" options:0 error:nil];
  NSMutableString *result = [NSMutableString string];
  NSUInteger cursor = 0;
  for (NSTextCheckingResult *match in [pattern matchesInString:value options:0 range:NSMakeRange(0, value.length)]) {
    id parameter = params[[value substringWithRange:[match rangeAtIndex:1]]];
    if (![parameter isKindOfClass:NSString.class] && ![parameter isKindOfClass:NSNumber.class]) return terminal;
    [result appendString:[value substringWithRange:NSMakeRange(cursor, match.range.location - cursor)]];
    [result appendString:[parameter isKindOfClass:NSString.class] ? parameter : [parameter stringValue]];
    cursor = NSMaxRange(match.range);
  }
  [result appendString:[value substringFromIndex:cursor]];
  return result;
}
static BOOL AccessDenied(NSError *error) {
  for (NSError *cause = error; cause; cause = cause.userInfo[NSUnderlyingErrorKey]) {
    if (([cause.domain isEqualToString:NSCocoaErrorDomain] && cause.code == NSFileReadNoPermissionError) ||
        ([cause.domain isEqualToString:NSPOSIXErrorDomain] && (cause.code == 1 || cause.code == 13))) return YES;
  }
  return NO;
}
static NSString *ErrorText(NSError *error) {
  if (!error) return @"";
  NSMutableArray *lines = [NSMutableArray arrayWithObject:L(error.userInfo[@"BabelMessageID"] ?: @"common.error.operation", error.userInfo[@"BabelMessageParams"])];
  for (NSError *cause = error; cause; cause = cause.userInfo[NSUnderlyingErrorKey]) {
    if ([cause.domain isEqualToString:NSCocoaErrorDomain] || [cause.domain isEqualToString:NSPOSIXErrorDomain]) {
      [lines addObject:L(@"common.systemMessage", @{@"message": [NSString stringWithFormat:@"%@ (%ld): %@", cause.domain, (long)cause.code, cause.localizedDescription]})];
      break;
    }
  }
  return [lines componentsJoinedByString:@"\n"];
}

#if BABEL_INSTALL_TEST
// Compile-time seams for the AppKit fixture: it fakes target identity, the quit,
// the launch and the installer exit, so no fixture ever resolves, quits or opens
// a real Discord. Production builds never replace these stages.
NSString * (^BabelTestRestartBundleID)(NSString *base);
BOOL (^BabelTestRestartQuit)(NSString *bundleID);
BOOL (^BabelTestRestartLaunch)(NSString *bundleID);
void (^BabelTestRestartExit)(void);
#endif

@interface InstallerDelegate : NSObject <NSApplicationDelegate, NSWindowDelegate>
@property NSWindow *window;
@property NSStackView *stack, *detailsContainer, *resultRow, *resultText, *recoveryRow;
@property NSView *symbolSlot;
@property NSImageView *iconView, *statusSymbol;
@property NSTextField *pathLabel, *statusLabel, *statusNext, *noteLabel;
@property NSTextView *details;
@property NSButton *installButton, *uninstallButton, *closeButton, *cleanupButton, *chooseButton, *disclosureButton;
@property NSProgressIndicator *progress;
@property NSAlert *uninstallAlert;
@property NSString *base, *profileState, *statusSymbolName, *statusTone, *lastAnnouncement, *restartBase, *restartAppID;
@property BOOL busy, validTarget, confirmationOpen, updatingLayout, layoutUpdateScheduled, folderAccessing, retriedAfterChoice, closeIsDefault;
@property CGFloat layoutWidth;
@property NSUInteger restartAttempt;
@property NSURL *selectedFolder;
@property NSLayoutConstraint *noteHeight, *statusHeight, *nextHeight;
@end

@implementation InstallerDelegate
- (NSTextField *)label:(NSString *)text {
  NSTextField *field = [NSTextField labelWithString:text];
  field.font = [NSFont systemFontOfSize:NSFont.systemFontSize];
  field.translatesAutoresizingMaskIntoConstraints = NO;
  return field;
}
- (NSTextField *)wrappingLabel:(NSString *)text {
  NSTextField *field = [self label:text];
  field.lineBreakMode = NSLineBreakByWordWrapping;
  field.maximumNumberOfLines = 0;
  field.cell.wraps = YES;
  field.cell.usesSingleLineMode = NO;
  field.cell.scrollable = NO;
  [field setContentHuggingPriority:NSLayoutPriorityRequired forOrientation:NSLayoutConstraintOrientationVertical];
  [field setContentCompressionResistancePriority:NSLayoutPriorityRequired forOrientation:NSLayoutConstraintOrientationVertical];
  return field;
}
- (NSButton *)button:(NSString *)text action:(SEL)action {
  NSButton *button = [NSButton buttonWithTitle:text target:self action:action];
  button.bezelStyle = NSBezelStyleRounded;
  button.translatesAutoresizingMaskIntoConstraints = NO;
  [button.widthAnchor constraintGreaterThanOrEqualToConstant:72].active = YES;
  return button;
}
- (NSString *)targetDetails:(NSString *)base {
  return [@[L(@"common.target", @{@"path": base}), L(@"common.data", @{@"path": [base stringByAppendingPathComponent:@"discord-translator-mod"]})] componentsJoinedByString:@"\n"];
}
- (void)applySymbol:(NSString *)name tone:(NSString *)tone {
  self.statusSymbolName = name ?: @"";
  self.statusTone = tone ?: @"";
  if (!self.statusSymbolName.length) {
    self.statusSymbol.image = nil;
    self.statusSymbol.hidden = YES;
    return;
  }
  NSImage *image = [NSImage imageWithSystemSymbolName:self.statusSymbolName accessibilityDescription:nil];
  self.statusSymbol.image = [image imageWithSymbolConfiguration:[NSImageSymbolConfiguration configurationWithPointSize:20 weight:NSFontWeightMedium]];
  self.statusSymbol.contentTintColor = [tone isEqualToString:@"success"] ? NSColor.systemGreenColor : [tone isEqualToString:@"warning"] ? NSColor.systemOrangeColor : NSColor.systemRedColor;
  self.statusSymbol.hidden = self.busy;
}
- (void)announceResult {
  NSString *text = self.statusLabel.stringValue ?: @"";
  if (self.statusNext.stringValue.length) text = [NSString stringWithFormat:@"%@\n%@", text, self.statusNext.stringValue];
  if (!text.length || [text isEqualToString:self.lastAnnouncement]) return;
  self.lastAnnouncement = text;
  NSAccessibilityPostNotificationWithUserInfo(self.window, NSAccessibilityAnnouncementRequestedNotification, @{NSAccessibilityAnnouncementKey: text, NSAccessibilityPriorityKey: @(NSAccessibilityPriorityHigh)});
  if (!NSApp.active) [NSApp requestUserAttention:NSInformationalRequest];
}
- (void)showResult:(NSString *)titleID next:(NSString *)next tone:(NSString *)tone symbol:(NSString *)symbol {
  self.statusLabel.stringValue = L(titleID, nil);
  self.statusLabel.textColor = NSColor.labelColor;
  self.statusNext.stringValue = next ?: @"";
  self.statusNext.hidden = self.statusNext.stringValue.length == 0;
  [self applySymbol:symbol tone:tone];
  [self announceResult];
  [self updateMinimum];
}
- (void)setRecoveryVisible:(BOOL)visible {
  self.chooseButton.hidden = !visible;
  self.recoveryRow.hidden = !visible;
}
- (void)setCloseDefault:(BOOL)enabled {
  self.closeIsDefault = enabled;
  self.closeButton.keyEquivalent = enabled ? @"\r" : @"\e";
  self.installButton.keyEquivalent = enabled ? @"" : @"\r";
}
- (void)applicationDidFinishLaunching:(NSNotification *)notification {
  self.base = NSProcessInfo.processInfo.environment[@"BABEL_TEST_BASE_DIR"] ?: [NSHomeDirectory() stringByAppendingPathComponent:@"Library/Application Support/discord"];
  self.window = [[NSWindow alloc] initWithContentRect:NSMakeRect(0, 0, 480, 320) styleMask:NSWindowStyleMaskTitled | NSWindowStyleMaskClosable | NSWindowStyleMaskMiniaturizable | NSWindowStyleMaskResizable backing:NSBackingStoreBuffered defer:NO];
  self.window.title = L(@"mac.title", nil);
  self.window.delegate = self;
  self.window.releasedWhenClosed = NO;
  self.window.contentMinSize = NSMakeSize(480, 1);
  self.window.contentMaxSize = NSMakeSize(CGFLOAT_MAX, CGFLOAT_MAX);
  NSView *content = self.window.contentView;
  self.stack = [[NSStackView alloc] init];
  self.stack.orientation = NSUserInterfaceLayoutOrientationVertical;
  self.stack.alignment = NSLayoutAttributeLeading;
  self.stack.spacing = 12;
  self.stack.detachesHiddenViews = YES;
  self.stack.translatesAutoresizingMaskIntoConstraints = NO;
  [content addSubview:self.stack];

  self.iconView = [[NSImageView alloc] init];
  self.iconView.image = NSApp.applicationIconImage;
  self.iconView.imageScaling = NSImageScaleProportionallyUpOrDown;
  self.iconView.translatesAutoresizingMaskIntoConstraints = NO;
  [NSLayoutConstraint activateConstraints:@[[self.iconView.widthAnchor constraintEqualToConstant:48], [self.iconView.heightAnchor constraintEqualToConstant:48]]];
  NSTextField *title = [self label:@"Babel"], *version = [self label:[@"v" stringByAppendingString:[NSBundle.mainBundle objectForInfoDictionaryKey:@"CFBundleShortVersionString"]]];
  title.font = [NSFont preferredFontForTextStyle:NSFontTextStyleHeadline options:@{}];
  version.textColor = NSColor.secondaryLabelColor;
  NSStackView *identity = [NSStackView stackViewWithViews:@[title, version]];
  identity.orientation = NSUserInterfaceLayoutOrientationVertical;
  identity.alignment = NSLayoutAttributeLeading;
  identity.spacing = 4;
  NSStackView *heading = [NSStackView stackViewWithViews:@[self.iconView, identity]];
  heading.alignment = NSLayoutAttributeCenterY;
  heading.spacing = 12;
  [identity setContentHuggingPriority:NSLayoutPriorityDefaultLow forOrientation:NSLayoutConstraintOrientationHorizontal];
  [self.stack addArrangedSubview:heading];

  self.symbolSlot = [[NSView alloc] init];
  self.symbolSlot.translatesAutoresizingMaskIntoConstraints = NO;
  [NSLayoutConstraint activateConstraints:@[[self.symbolSlot.widthAnchor constraintEqualToConstant:24], [self.symbolSlot.heightAnchor constraintEqualToConstant:24]]];
  self.statusSymbol = [[NSImageView alloc] init];
  self.statusSymbol.translatesAutoresizingMaskIntoConstraints = NO;
  self.statusSymbol.imageScaling = NSImageScaleProportionallyUpOrDown;
  self.statusSymbol.hidden = YES;
  [self.statusSymbol setAccessibilityElement:NO];
  self.progress = [[NSProgressIndicator alloc] init];
  self.progress.style = NSProgressIndicatorStyleSpinning;
  self.progress.controlSize = NSControlSizeSmall;
  self.progress.displayedWhenStopped = NO;
  self.progress.hidden = YES;
  self.progress.translatesAutoresizingMaskIntoConstraints = NO;
  [self.symbolSlot addSubview:self.statusSymbol];
  [self.symbolSlot addSubview:self.progress];
  [NSLayoutConstraint activateConstraints:@[
    [self.statusSymbol.centerXAnchor constraintEqualToAnchor:self.symbolSlot.centerXAnchor],
    [self.statusSymbol.centerYAnchor constraintEqualToAnchor:self.symbolSlot.centerYAnchor],
    [self.statusSymbol.widthAnchor constraintEqualToConstant:24],
    [self.statusSymbol.heightAnchor constraintEqualToConstant:24],
    [self.progress.centerXAnchor constraintEqualToAnchor:self.symbolSlot.centerXAnchor],
    [self.progress.centerYAnchor constraintEqualToAnchor:self.symbolSlot.centerYAnchor],
    [self.progress.widthAnchor constraintEqualToConstant:16],
    [self.progress.heightAnchor constraintEqualToConstant:16]
  ]];
  self.statusLabel = [self wrappingLabel:L(@"common.detecting", nil)];
  self.statusLabel.font = [NSFont systemFontOfSize:15 weight:NSFontWeightSemibold];
  self.statusLabel.textColor = NSColor.labelColor;
  self.statusNext = [self wrappingLabel:@""];
  self.statusNext.font = [NSFont systemFontOfSize:13];
  self.statusNext.textColor = NSColor.secondaryLabelColor;
  self.statusNext.hidden = YES;
  self.statusHeight = [self.statusLabel.heightAnchor constraintEqualToConstant:20];
  self.nextHeight = [self.statusNext.heightAnchor constraintEqualToConstant:0];
  self.statusHeight.active = YES;
  self.nextHeight.active = YES;
  self.resultText = [NSStackView stackViewWithViews:@[self.statusLabel, self.statusNext]];
  self.resultText.orientation = NSUserInterfaceLayoutOrientationVertical;
  self.resultText.alignment = NSLayoutAttributeLeading;
  self.resultText.spacing = 2;
  self.resultText.detachesHiddenViews = YES;
  [self.resultText setContentHuggingPriority:NSLayoutPriorityDefaultLow forOrientation:NSLayoutConstraintOrientationHorizontal];
  [self.resultText setContentCompressionResistancePriority:NSLayoutPriorityDefaultLow forOrientation:NSLayoutConstraintOrientationHorizontal];
  self.resultRow = [NSStackView stackViewWithViews:@[self.symbolSlot, self.resultText]];
  self.resultRow.orientation = NSUserInterfaceLayoutOrientationHorizontal;
  self.resultRow.alignment = NSLayoutAttributeTop;
  self.resultRow.spacing = 8;
  [self.resultText.widthAnchor constraintEqualToAnchor:self.resultRow.widthAnchor constant:-32].active = YES;
  [self.statusLabel.widthAnchor constraintEqualToAnchor:self.resultText.widthAnchor].active = YES;
  [self.statusNext.widthAnchor constraintEqualToAnchor:self.resultText.widthAnchor].active = YES;
  [self.stack addArrangedSubview:self.resultRow];
  [self.stack setCustomSpacing:8 afterView:self.resultRow];

  self.chooseButton = [self button:L(@"mac.chooseFolder", nil) action:@selector(chooseFolder:)];
  self.recoveryRow = [NSStackView stackViewWithViews:@[self.chooseButton]];
  self.recoveryRow.orientation = NSUserInterfaceLayoutOrientationHorizontal;
  self.recoveryRow.alignment = NSLayoutAttributeCenterY;
  self.recoveryRow.spacing = 8;
  self.recoveryRow.hidden = YES;
  self.chooseButton.hidden = YES;
  [self.stack addArrangedSubview:self.recoveryRow];
  // The native disclosure bezel is a triangle only; its label is a sibling.
  self.disclosureButton = [NSButton buttonWithTitle:@"" target:self action:@selector(toggleDetails:)];
  [self.disclosureButton setButtonType:NSButtonTypeOnOff];
  self.disclosureButton.bezelStyle = NSBezelStyleDisclosure;
  self.disclosureButton.imagePosition = NSImageOnly;
  self.disclosureButton.accessibilityLabel = L(@"mac.details", nil);
  self.disclosureButton.state = NSControlStateValueOff;
  self.disclosureButton.translatesAutoresizingMaskIntoConstraints = NO;
  [self.disclosureButton.widthAnchor constraintEqualToConstant:20].active = YES;
  NSStackView *disclosureRow = [NSStackView stackViewWithViews:@[self.disclosureButton, [self label:L(@"mac.details", nil)]]];
  disclosureRow.alignment = NSLayoutAttributeCenterY;
  disclosureRow.spacing = 4;
  [self.stack addArrangedSubview:disclosureRow];

  self.pathLabel = [self label:self.base];
  self.pathLabel.selectable = YES;
  self.pathLabel.lineBreakMode = NSLineBreakByTruncatingMiddle;
  self.pathLabel.toolTip = self.base;
  self.noteLabel = [self wrappingLabel:@""];
  self.noteLabel.textColor = NSColor.secondaryLabelColor;
  self.noteHeight = [self.noteLabel.heightAnchor constraintEqualToConstant:0];
  self.noteHeight.active = YES;
  NSScrollView *scroll = [[NSScrollView alloc] init];
  scroll.translatesAutoresizingMaskIntoConstraints = NO;
  scroll.hasVerticalScroller = YES;
  scroll.borderType = NSBezelBorder;
  [scroll setContentHuggingPriority:NSLayoutPriorityDefaultLow forOrientation:NSLayoutConstraintOrientationVertical];
  [scroll setContentCompressionResistancePriority:NSLayoutPriorityDefaultLow forOrientation:NSLayoutConstraintOrientationVertical];
  self.details = [[NSTextView alloc] initWithFrame:NSMakeRect(0, 0, 440, 120)];
  self.details.editable = NO;
  self.details.selectable = YES;
  self.details.font = [NSFont systemFontOfSize:NSFont.systemFontSize];
  self.details.autoresizingMask = NSViewWidthSizable;
  self.details.textContainer.widthTracksTextView = YES;
  self.details.textContainer.containerSize = NSMakeSize(440, CGFLOAT_MAX);
  scroll.documentView = self.details;
  [scroll.heightAnchor constraintGreaterThanOrEqualToConstant:120].active = YES;
  self.detailsContainer = [NSStackView stackViewWithViews:@[[self label:L(@"mac.target", nil)], self.pathLabel, self.noteLabel, scroll]];
  self.detailsContainer.orientation = NSUserInterfaceLayoutOrientationVertical;
  self.detailsContainer.alignment = NSLayoutAttributeLeading;
  self.detailsContainer.spacing = 8;
  [self.detailsContainer setContentHuggingPriority:NSLayoutPriorityDefaultLow forOrientation:NSLayoutConstraintOrientationVertical];
  for (NSView *view in self.detailsContainer.arrangedSubviews) [view.widthAnchor constraintEqualToAnchor:self.detailsContainer.widthAnchor].active = YES;
  [self.stack addArrangedSubview:self.detailsContainer];
  self.detailsContainer.hidden = YES;

  // The data-removal checkbox belongs only to the uninstall confirmation sheet.
  self.cleanupButton = [NSButton checkboxWithTitle:L(@"mac.cleanup", nil) target:self action:nil];
  self.cleanupButton.state = NSControlStateValueOff;
  self.cleanupButton.cell.wraps = YES;
  self.uninstallButton = [self button:L(@"mac.uninstall", nil) action:@selector(uninstall:)];
  self.closeButton = [self button:L(@"mac.close", nil) action:@selector(close:)];
  self.installButton = [self button:L(@"mac.install", nil) action:@selector(install:)];
  [self setCloseDefault:NO];
  NSView *spacer = [[NSView alloc] init];
  spacer.translatesAutoresizingMaskIntoConstraints = NO;
  NSStackView *footer = [NSStackView stackViewWithViews:@[self.uninstallButton, spacer, self.closeButton, self.installButton]];
  footer.spacing = 12;
  [spacer setContentHuggingPriority:NSLayoutPriorityDefaultLow forOrientation:NSLayoutConstraintOrientationHorizontal];
  [spacer setContentCompressionResistancePriority:NSLayoutPriorityDefaultLow forOrientation:NSLayoutConstraintOrientationHorizontal];
  [spacer.heightAnchor constraintEqualToAnchor:self.installButton.heightAnchor].active = YES;
  [self.stack addArrangedSubview:footer];
  for (NSView *view in self.stack.arrangedSubviews) [view.widthAnchor constraintEqualToAnchor:self.stack.widthAnchor].active = YES;
  [NSLayoutConstraint activateConstraints:@[[self.stack.leadingAnchor constraintEqualToAnchor:content.leadingAnchor constant:20], [self.stack.trailingAnchor constraintEqualToAnchor:content.trailingAnchor constant:-20], [self.stack.topAnchor constraintEqualToAnchor:content.topAnchor constant:20], [self.stack.bottomAnchor constraintEqualToAnchor:content.bottomAnchor constant:-20]]];
  self.disclosureButton.nextKeyView = self.uninstallButton;
  self.uninstallButton.nextKeyView = self.closeButton;
  self.closeButton.nextKeyView = self.installButton;
  self.installButton.nextKeyView = self.disclosureButton;
  [self refreshProfile];
  self.details.string = [self targetDetails:self.base];
  [self updateMinimum];
  [self.window center];
  [self.window makeKeyAndOrderFront:nil];
  [NSApp activateIgnoringOtherApps:YES];
  NSArray *args = NSProcessInfo.processInfo.arguments;
  NSUInteger smoke = [args indexOfObject:@"--smoke-ui"];
  if (smoke != NSNotFound && smoke + 1 < args.count) {
    // Exercise the real NSApplication display cycle before reporting success.
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, NSEC_PER_SEC), dispatch_get_main_queue(), ^{
    NSDictionary *state = @{@"version": [NSBundle.mainBundle objectForInfoDictionaryKey:@"CFBundleShortVersionString"], @"window": NSStringFromClass(self.window.class), @"icon": NSStringFromClass(self.iconView.class), @"path": NSStringFromClass(self.pathLabel.class), @"details": NSStringFromClass(self.details.class), @"disclosure": NSStringFromClass(self.disclosureButton.class), @"checkbox": NSStringFromClass(self.cleanupButton.class), @"install": NSStringFromClass(self.installButton.class), @"uninstall": NSStringFromClass(self.uninstallButton.class), @"close": NSStringFromClass(self.closeButton.class), @"detailsCollapsed": @(self.detailsContainer.hidden), @"cleanupInMainWindow": @(self.cleanupButton.window == self.window), @"cleanupSelectedByDefault": @(self.cleanupButton.state == NSControlStateValueOn)};
    NSData *data = [NSJSONSerialization dataWithJSONObject:state options:0 error:nil];
    if (![data writeToFile:args[smoke + 1] atomically:YES]) exit(1);
    [NSApp terminate:nil];
    });
    return;
  }
  [self detectTarget:nil];
}
- (void)detectTarget:(id)sender {
  if (self.busy || self.confirmationOpen) return;
  [self clearRestartTarget];
  self.validTarget = NO;
  self.profileState = @"Unknown";
  self.statusNext.stringValue = @"";
  self.statusNext.hidden = YES;
  [self applySymbol:@"" tone:@""];
  [self setWorking:YES];
  self.statusLabel.textColor = NSColor.labelColor;
  self.statusLabel.stringValue = L(@"common.detecting", nil);
  [self updateMinimum];
  NSString *base = self.base;
  BOOL retried = self.retriedAfterChoice;
  self.retriedAfterChoice = NO;
  dispatch_async(dispatch_get_global_queue(QOS_CLASS_USER_INITIATED, 0), ^{
    NSError *error = nil;
    BOOL valid = BabelTargetValid(base, &error), denied = AccessDenied(error);
    NSString *profile = valid ? BabelProfileState(base) : @"Unknown";
    dispatch_async(dispatch_get_main_queue(), ^{
      if (![base isEqualToString:self.base]) return;
      self.validTarget = valid;
      self.profileState = profile;
      [self setWorking:NO];
      NSString *title = @"common.ready", *next = L(@"common.readyNext", nil), *tone = @"", *symbol = @"";
      BOOL recovery = NO;
      if (!valid && denied) {
        title = @"mac.permissionSummary";
        next = L(retried ? @"mac.permissionStill" : @"mac.permissionNext", nil);
        tone = retried ? @"failure" : @"warning";
        symbol = retried ? @"xmark.octagon.fill" : @"exclamationmark.triangle.fill";
        recovery = YES;
      } else if (!valid) {
        title = @"common.error.targetMissing";
        next = L(@"mac.notFound", nil);
        tone = @"warning";
        symbol = @"exclamationmark.triangle.fill";
        recovery = YES;
      }
      [self setRecoveryVisible:recovery];
      NSMutableArray *lines = [NSMutableArray arrayWithObject:[self targetDetails:base]];
      if (error) [lines addObject:ErrorText(error)];
      self.details.string = [lines componentsJoinedByString:@"\n"];
      [self refreshProfile];
      [self showResult:title next:next tone:tone symbol:symbol];
    });
  });
}
- (void)chooseFolder:(id)sender {
  if (self.busy || self.confirmationOpen) return;
  NSOpenPanel *panel = [NSOpenPanel openPanel];
  panel.canChooseFiles = NO;
  panel.canChooseDirectories = YES;
  panel.allowsMultipleSelection = NO;
  panel.directoryURL = [NSURL fileURLWithPath:[self.base stringByDeletingLastPathComponent]];
  panel.prompt = L(@"mac.choose", nil);
  panel.message = L(@"mac.chooseNamed", @{@"name": self.base.lastPathComponent});
  [panel beginSheetModalForWindow:self.window completionHandler:^(NSModalResponse response) {
    if (response != NSModalResponseOK || !panel.URL) return;
    [self useChosenFolder:panel.URL];
  }];
}
- (void)useChosenFolder:(NSURL *)url {
  if (!url || self.busy || self.confirmationOpen) return;
  if (self.folderAccessing) [self.selectedFolder stopAccessingSecurityScopedResource];
  self.selectedFolder = url;
  self.folderAccessing = [url startAccessingSecurityScopedResource];
  self.base = url.path;
  self.pathLabel.stringValue = self.base;
  self.pathLabel.toolTip = self.base;
  self.retriedAfterChoice = YES;
  [self detectTarget:nil];
}
- (void)toggleDetails:(id)sender {
  self.detailsContainer.hidden = self.disclosureButton.state != NSControlStateValueOn;
  self.disclosureButton.nextKeyView = self.detailsContainer.hidden ? self.uninstallButton : self.pathLabel;
  self.pathLabel.nextKeyView = self.details;
  self.details.nextKeyView = self.uninstallButton;
  [self updateMinimum];
}
- (BOOL)validateMenuItem:(NSMenuItem *)item {
  return (item.action == @selector(chooseFolder:) || item.action == @selector(detectTarget:)) ? !self.busy && !self.confirmationOpen : YES;
}
- (void)applicationWillTerminate:(NSNotification *)notification {
  if (self.folderAccessing) [self.selectedFolder stopAccessingSecurityScopedResource];
}
- (CGFloat)heightForText:(NSString *)text font:(NSFont *)font width:(CGFloat)width {
  if (!text.length || !font) return 0;
  NSRect rect = [text boundingRectWithSize:NSMakeSize(MAX(1, width), CGFLOAT_MAX) options:NSStringDrawingUsesLineFragmentOrigin | NSStringDrawingUsesFontLeading attributes:@{NSFontAttributeName: font}];
  return ceil(rect.size.height) + 2;
}
- (void)updateMinimum {
  if (self.updatingLayout) return;
  self.updatingLayout = YES;
  CGFloat width = MAX(1, self.window.contentView.bounds.size.width - 40);
  self.layoutWidth = width;
  CGFloat textWidth = MAX(1, width - 32);
  self.statusLabel.preferredMaxLayoutWidth = textWidth;
  self.statusNext.preferredMaxLayoutWidth = textWidth;
  self.noteLabel.preferredMaxLayoutWidth = width;
  self.statusHeight.constant = MAX(15, [self heightForText:self.statusLabel.stringValue font:self.statusLabel.font width:textWidth]);
  self.nextHeight.constant = self.statusNext.hidden || !self.statusNext.stringValue.length ? 0 : [self heightForText:self.statusNext.stringValue font:self.statusNext.font width:textWidth];
  self.noteHeight.constant = [self heightForText:self.noteLabel.stringValue font:self.noteLabel.font width:width];
  [self.window.contentView layoutSubtreeIfNeeded];
  NSSize fitting = self.stack.fittingSize;
  CGFloat height = ceil(fitting.height + 40);
  CGFloat minW = MAX(480, ceil(fitting.width + 40));
  BOOL expanded = !self.detailsContainer.hidden;
  self.window.contentMinSize = NSMakeSize(minW, height);
  self.window.contentMaxSize = NSMakeSize(CGFLOAT_MAX, expanded ? CGFLOAT_MAX : height);
  NSRect frame = self.window.frame;
  CGFloat top = NSMaxY(frame);
  NSRect content = [self.window contentRectForFrameRect:frame];
  CGFloat targetH = expanded ? MAX(content.size.height, height) : height;
  CGFloat targetW = MAX(content.size.width, minW);
  if (fabs(content.size.height - targetH) > 0.5 || content.size.width + 0.5 < targetW) {
    content.size.height = targetH;
    content.size.width = targetW;
    NSRect next = [self.window frameRectForContentRect:content];
    next.origin.y = top - next.size.height;
    next.origin.x = frame.origin.x;
    [self.window setFrame:next display:YES animate:NO];
  }
  self.updatingLayout = NO;
}
- (void)windowDidResize:(NSNotification *)notification {
  // A height change does not affect wrapping. Do not mutate window constraints
  // from inside AppKit's display-cycle layout callback (which can recurse).
  if (fabs(self.window.contentView.bounds.size.width - 40 - self.layoutWidth) < 0.5 || self.layoutUpdateScheduled) return;
  self.layoutUpdateScheduled = YES;
  dispatch_async(dispatch_get_main_queue(), ^{
    self.layoutUpdateScheduled = NO;
    [self updateMinimum];
  });
}
- (void)refreshProfile {
  NSString *state = self.profileState ?: @"Unknown";
  self.cleanupButton.enabled = !self.busy && [state isEqualToString:@"Known"];
  self.noteLabel.stringValue = L([state isEqualToString:@"Known"] ? @"common.profile.known" : [state isEqualToString:@"KnownAbsent"] ? @"common.profile.absent" : @"common.profile.unknown", nil);
}
- (void)setWorking:(BOOL)value {
  self.busy = value;
  self.installButton.enabled = !value && self.validTarget;
  self.uninstallButton.enabled = !value && self.validTarget;
  self.closeButton.enabled = !value;
  self.chooseButton.enabled = !value;
  [self.window standardWindowButton:NSWindowCloseButton].enabled = !value;
  [self refreshProfile];
  self.progress.hidden = !value;
  self.statusSymbol.hidden = value || !self.statusSymbolName.length;
  if (value && !NSWorkspace.sharedWorkspace.accessibilityDisplayShouldReduceMotion) [self.progress startAnimation:nil];
  else [self.progress stopAnimation:nil];
}
- (void)run:(BOOL)install removeData:(BOOL)remove {
  if (self.busy || self.confirmationOpen || !self.validTarget) return;
  [self clearRestartTarget];
  [self setRecoveryVisible:NO];
  [self applySymbol:@"" tone:@""];
  [self setWorking:YES];
  self.statusLabel.textColor = NSColor.labelColor;
  self.statusLabel.stringValue = L(install ? @"common.installing" : @"common.uninstalling", nil);
  self.statusNext.stringValue = @"";
  self.statusNext.hidden = YES;
  [self updateMinimum];
  NSString *base = self.base, *payload = [NSBundle.mainBundle.resourcePath stringByAppendingPathComponent:@"payload"];
  dispatch_async(dispatch_get_global_queue(QOS_CLASS_USER_INITIATED, 0), ^{
    NSError *error = nil;
    NSMutableArray *steps = [NSMutableArray array];
    BOOL ok = install ? BabelInstall(base, payload, &error) : BabelUninstallWithOptions(base, remove, base, steps, &error);
    NSString *profile = BabelProfileState(base);
    dispatch_async(dispatch_get_main_queue(), ^{
      if (![base isEqualToString:self.base]) return;
      self.profileState = profile;
      NSString *messageID = error.userInfo[@"BabelMessageID"] ?: @"";
      NSString *detailPrefix = [NSString stringWithFormat:@"%@.%@.", @"common", @"detail"];
      BOOL warning = ok && [messageID hasPrefix:detailPrefix];
      // Restart Discord replaces Close only after a successful install of a
      // target whose application identity is proven.
      BOOL armed = NO;
      if (ok && install) {
        NSString *bundleID = [self restartBundleID];
        if (bundleID.length) { [self setRestartTarget:base bundleID:bundleID]; armed = YES; }
        else [self clearRestartTarget];
      } else [self clearRestartTarget];
      NSString *restartNext = armed ? L(@"common.restartNext", nil) : L(@"mac.restartSteps", nil);
      NSString *title = install ? @"common.installed" : @"common.uninstalled";
      NSString *next = restartNext, *tone = @"success", *symbol = @"checkmark.circle.fill";
      BOOL recovery = NO;
      if (warning) {
        title = @"common.installed";
        next = [@[restartNext, L(@"common.cleanupLeftover", nil)] componentsJoinedByString:@"\n"];
        tone = @"warning";
        symbol = @"exclamationmark.triangle.fill";
      } else if (!ok) {
        title = install ? @"common.installFailed" : @"common.uninstallFailed";
        tone = @"failure";
        symbol = @"xmark.octagon.fill";
        if (AccessDenied(error)) {
          next = L(@"mac.permissionNext", nil);
          recovery = YES;
        } else if (messageID.length) next = [@[L(messageID, error.userInfo[@"BabelMessageParams"]), L(@"common.seeDetails", nil)] componentsJoinedByString:@" "];
        else next = L(@"common.seeDetails", nil);
      }
      [self setRecoveryVisible:recovery];
      NSMutableArray *lines = [NSMutableArray arrayWithObject:L(@"common.target", @{@"path": base})];
      if (install) [lines addObject:L(@"common.savedData", @{@"path": [base stringByAppendingPathComponent:@"discord-translator-mod"]})];
      if (error) [lines addObject:ErrorText(error)];
      for (NSDictionary *step in steps) {
        [lines addObject:[NSString stringWithFormat:@"%@ — %@", L(step[@"actionID"], nil), L(step[@"stateID"], nil)]];
        [lines addObject:step[@"path"]];
        if ([step[@"detailID"] length]) [lines addObject:L(step[@"detailID"], nil)];
        if (step[@"systemError"] && ([step[@"systemErrorDomain"] isEqualToString:NSCocoaErrorDomain] || [step[@"systemErrorDomain"] isEqualToString:NSPOSIXErrorDomain])) [lines addObject:L(@"common.systemMessage", @{@"message": step[@"systemError"]})];
      }
      self.details.string = [lines componentsJoinedByString:@"\n"];
      self.cleanupButton.state = NSControlStateValueOff;
      [self setCloseDefault:ok];
      [self setWorking:NO];
      [self showResult:title next:next tone:tone symbol:symbol];
    });
  });
}
- (void)install:(id)sender { [self run:YES removeData:NO]; }
- (void)uninstall:(id)sender {
  if (self.busy || self.confirmationOpen || !self.validTarget) return;
  self.confirmationOpen = YES;
  self.cleanupButton.state = NSControlStateValueOff;
  [self refreshProfile];
  NSAlert *alert = [[NSAlert alloc] init];
  self.uninstallAlert = alert;
  alert.messageText = L(@"mac.uninstallTitle", nil);
  alert.informativeText = L(@"mac.uninstallMessage", nil);
  [alert addButtonWithTitle:L(@"mac.uninstall", nil)];
  [alert addButtonWithTitle:L(@"mac.cancel", nil)];
  CGFloat width = 400, checkboxHeight = MAX(18, [self heightForText:self.cleanupButton.title font:self.cleanupButton.font width:width - 22]);
  NSTextField *note = [self wrappingLabel:self.noteLabel.stringValue];
  note.textColor = NSColor.secondaryLabelColor;
  CGFloat noteHeight = [self heightForText:note.stringValue font:note.font width:width];
  NSView *accessory = [[NSView alloc] initWithFrame:NSMakeRect(0, 0, width, checkboxHeight + noteHeight + 8)];
  self.cleanupButton.frame = NSMakeRect(0, noteHeight + 8, width, checkboxHeight);
  note.translatesAutoresizingMaskIntoConstraints = YES;
  note.frame = NSMakeRect(0, 0, width, noteHeight);
  [accessory addSubview:self.cleanupButton];
  [accessory addSubview:note];
  alert.accessoryView = accessory;
  [alert beginSheetModalForWindow:self.window completionHandler:^(NSModalResponse response) {
    BOOL remove = self.cleanupButton.enabled && self.cleanupButton.state == NSControlStateValueOn;
    self.confirmationOpen = NO;
    self.uninstallAlert = nil;
    [self.cleanupButton removeFromSuperview];
    self.cleanupButton.state = NSControlStateValueOff;
    if (response == NSAlertFirstButtonReturn) [self run:NO removeData:remove];
  }];
}
- (void)close:(id)sender { [self.window performClose:sender]; }

// Restart is a tiny local state machine: identity, quit, launch, exit. Each
// stage finishes once on the main thread, and a stale attempt can never fail a
// retry because every continuation checks the attempt it was started with.
- (NSString *)restartBundleID {
#if BABEL_INSTALL_TEST
  if (BabelTestRestartBundleID) return BabelTestRestartBundleID(self.base);
#endif
  return BabelChannelBundleID(self.base);
}
- (void)setRestartTarget:(NSString *)base bundleID:(NSString *)bundleID {
  self.restartBase = base;
  self.restartAppID = bundleID;
  self.closeButton.title = L(@"mac.restart", nil);
  self.closeButton.action = @selector(restartDiscord:);
}
- (void)clearRestartTarget {
  self.restartBase = nil;
  self.restartAppID = nil;
  self.closeButton.title = L(@"mac.close", nil);
  self.closeButton.action = @selector(close:);
}
- (void)appendRestartDetail:(NSString *)detailID error:(NSError *)error {
  NSMutableArray *lines = [NSMutableArray array];
  if (self.details.string.length) [lines addObject:self.details.string];
  [lines addObject:L(detailID, nil)];
  for (NSError *cause = error; cause; cause = cause.userInfo[NSUnderlyingErrorKey]) {
    if ([cause.domain isEqualToString:NSCocoaErrorDomain] || [cause.domain isEqualToString:NSPOSIXErrorDomain]) {
      [lines addObject:L(@"common.systemMessage", @{@"message": [NSString stringWithFormat:@"%@ (%ld): %@", cause.domain, (long)cause.code, cause.localizedDescription]})];
      break;
    }
  }
  self.details.string = [lines componentsJoinedByString:@"\n"];
}
- (void)restartFailed:(NSString *)detailID error:(NSError *)error openManually:(BOOL)openManually {
  [self setWorking:NO];
  [self appendRestartDetail:detailID error:error];
  // The restart target stays armed so the user can retry.
  [self showResult:@"common.restartFailed" next:(openManually ? L(@"mac.openManually", nil) : L(@"mac.restartSteps", nil)) tone:@"failure" symbol:@"xmark.octagon.fill"];
}
// The stored identity is rechecked before the quit and again before the launch;
// a mismatch resets to Close and points at a fresh install.
- (BOOL)restartTargetStillMatches:(NSString *)bundleID {
  return self.restartBase.length && [self.base isEqualToString:self.restartBase]
    && [bundleID isEqualToString:self.restartAppID] && [bundleID isEqualToString:[self restartBundleID]];
}
- (void)restartTargetChanged {
  [self setWorking:NO];
  [self clearRestartTarget];
  [self setCloseDefault:YES];
  [self showResult:@"common.error.targetChanged" next:L(@"common.readyNext", nil) tone:@"failure" symbol:@"xmark.octagon.fill"];
}
- (void)restartDiscord:(id)sender {
  if (self.busy || self.confirmationOpen || !self.restartAppID.length) return;
  if (![self restartTargetStillMatches:self.restartAppID]) { [self restartTargetChanged]; return; }
  NSUInteger attempt = self.restartAttempt + 1;
  self.restartAttempt = attempt;
  [self setWorking:YES];
  self.statusLabel.textColor = NSColor.labelColor;
  self.statusLabel.stringValue = L(@"common.restarting", nil);
  self.statusNext.stringValue = @"";
  self.statusNext.hidden = YES;
  [self updateMinimum];
  NSString *bundleID = self.restartAppID;
  [self restartQuit:bundleID completion:^(BOOL quit, NSURL *url, NSString *detailID, NSError *error) {
    if (attempt != self.restartAttempt) return;
    if (![self restartTargetStillMatches:bundleID]) { [self restartTargetChanged]; return; }
    if (!quit) { [self restartFailed:detailID error:error openManually:NO]; return; }
    [self restartLaunch:url bundleID:bundleID completion:^(BOOL launched, NSError *launchError) {
      if (attempt != self.restartAttempt) return;
      if (![self restartTargetStillMatches:bundleID]) { [self restartTargetChanged]; return; }
      if (!launched) { [self restartFailed:@"common.detail.launchFailed" error:launchError openManually:YES]; return; }
      [self setWorking:NO];
      [self restartExit];
    }];
  }];
}
- (void)restartQuit:(NSString *)bundleID completion:(void (^)(BOOL ok, NSURL *url, NSString *detailID, NSError *error))done {
#if BABEL_INSTALL_TEST
  if (BabelTestRestartQuit) {
    BOOL ok = BabelTestRestartQuit(bundleID);
    dispatch_async(dispatch_get_main_queue(), ^{
      done(ok, [NSURL fileURLWithPath:@"/Applications/Discord.app"], ok ? nil : @"common.detail.notQuit", nil);
    });
    return;
  }
#endif
  NSArray<NSRunningApplication *> *apps = [NSRunningApplication runningApplicationsWithBundleIdentifier:bundleID];
  NSURL *url = apps.firstObject.bundleURL ?: [NSWorkspace.sharedWorkspace URLForApplicationWithBundleIdentifier:bundleID];
  if (!url || ![[NSBundle bundleWithURL:url].bundleIdentifier isEqualToString:bundleID]) {
    done(NO, nil, @"common.detail.unverified", nil);
    return;
  }
  NSMutableArray<NSRunningApplication *> *pending = [NSMutableArray array];
  for (NSRunningApplication *app in apps) if (!app.terminated) [pending addObject:app];
  if (!pending.count) { done(YES, url, nil, nil); return; }
  // One normal quit request per running copy, as Discord ▸ Quit would send.
  // There is no force-quit: on timeout the user quits Discord by hand.
  NSNotificationCenter *center = NSWorkspace.sharedWorkspace.notificationCenter;
  __block id observer = nil;
  __block BOOL finished = NO;
  void (^finish)(BOOL, NSError *) = ^(BOOL ok, NSError *error) {
    if (finished) return;
    finished = YES;
    if (observer) [center removeObserver:observer];
    done(ok, url, ok ? nil : @"common.detail.notQuit", error);
  };
  observer = [center addObserverForName:NSWorkspaceDidTerminateApplicationNotification object:nil queue:NSOperationQueue.mainQueue usingBlock:^(NSNotification *note) {
    NSRunningApplication *app = note.userInfo[NSWorkspaceApplicationKey];
    for (NSRunningApplication *item in pending.copy) if (item == app || item.terminated) [pending removeObject:item];
    if (!pending.count) finish(YES, nil);
  }];
  for (NSRunningApplication *app in pending.copy) [app terminate];
  for (NSRunningApplication *item in pending.copy) if (item.terminated) [pending removeObject:item];
  if (!pending.count) finish(YES, nil);
  else dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(15 * NSEC_PER_SEC)), dispatch_get_main_queue(), ^{ finish(NO, nil); });
}
- (void)restartLaunch:(NSURL *)url bundleID:(NSString *)bundleID completion:(void (^)(BOOL ok, NSError *error))done {
#if BABEL_INSTALL_TEST
  if (BabelTestRestartLaunch) {
    BOOL ok = BabelTestRestartLaunch(bundleID);
    dispatch_async(dispatch_get_main_queue(), ^{ done(ok, nil); });
    return;
  }
#endif
  (void)bundleID;
  [NSWorkspace.sharedWorkspace openApplicationAtURL:url configuration:[NSWorkspaceOpenConfiguration configuration] completionHandler:^(NSRunningApplication *app, NSError *error) {
    dispatch_async(dispatch_get_main_queue(), ^{ done(app != nil && error == nil, error); });
  }];
}
- (void)restartExit {
#if BABEL_INSTALL_TEST
  if (BabelTestRestartExit) { BabelTestRestartExit(); return; }
#endif
  [NSApp terminate:nil];
}
- (BOOL)windowShouldClose:(NSWindow *)sender { return !self.busy && !self.confirmationOpen; }
- (NSApplicationTerminateReply)applicationShouldTerminate:(NSApplication *)sender { return self.busy || self.confirmationOpen ? NSTerminateCancel : NSTerminateNow; }
- (BOOL)applicationShouldTerminateAfterLastWindowClosed:(NSApplication *)sender { return YES; }
@end

int main(int argc, const char *argv[]) {
  @autoreleasepool {
    [NSApplication sharedApplication];
    [NSApp setActivationPolicy:NSApplicationActivationPolicyRegular];
    NSMenu *menu = [[NSMenu alloc] init], *appMenu = [[NSMenu alloc] initWithTitle:L(@"mac.title", nil)], *editMenu = [[NSMenu alloc] initWithTitle:L(@"mac.edit", nil)], *fileMenu = [[NSMenu alloc] initWithTitle:L(@"mac.file", nil)];
    NSMenuItem *appItem = [[NSMenuItem alloc] initWithTitle:L(@"mac.title", nil) action:nil keyEquivalent:@""], *editItem = [[NSMenuItem alloc] initWithTitle:L(@"mac.edit", nil) action:nil keyEquivalent:@""], *fileItem = [[NSMenuItem alloc] initWithTitle:L(@"mac.file", nil) action:nil keyEquivalent:@""];
    appItem.submenu = appMenu; editItem.submenu = editMenu; fileItem.submenu = fileMenu;
    [menu addItem:appItem]; [menu addItem:fileItem]; [menu addItem:editItem];
    [appMenu addItemWithTitle:L(@"mac.close", nil) action:@selector(performClose:) keyEquivalent:@"w"];
    [appMenu addItemWithTitle:L(@"mac.quit", nil) action:@selector(terminate:) keyEquivalent:@"q"];
    [editMenu addItemWithTitle:L(@"mac.copy", nil) action:@selector(copy:) keyEquivalent:@"c"];
    [editMenu addItemWithTitle:L(@"mac.selectAll", nil) action:@selector(selectAll:) keyEquivalent:@"a"];
    NSApp.mainMenu = menu;
    __attribute__((objc_precise_lifetime)) InstallerDelegate *delegate = [InstallerDelegate new];
    NSApp.delegate = delegate;
    [fileMenu addItemWithTitle:L(@"mac.chooseFolder", nil) action:@selector(chooseFolder:) keyEquivalent:@"o"].target = delegate;
    [fileMenu addItemWithTitle:L(@"mac.redetect", nil) action:@selector(detectTarget:) keyEquivalent:@"r"].target = delegate;
    [NSApp run];
  }
  return 0;
}
