"use strict";
const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path"),os=require("node:os"),cp=require("node:child_process");
const root=path.resolve(__dirname,"..");
// Each process uses NSArgumentDomain preferences on an isolated test bundle.
// No global defaults or real Discord files are read or modified.
const driver=String.raw`
#define main BabelProgramMain
#import "InstallerWindow.m"
#undef main
static void Drain(InstallerDelegate *delegate) {
 NSDate *end=[NSDate dateWithTimeIntervalSinceNow:15];
 while((delegate.busy || delegate.confirmationOpen) && [end timeIntervalSinceNow]>0)[NSRunLoop.currentRunLoop runUntilDate:[NSDate dateWithTimeIntervalSinceNow:0.02]];
 if(delegate.busy || delegate.confirmationOpen)exit(2);[delegate.window.contentView layoutSubtreeIfNeeded];[delegate.window displayIfNeeded];
}
static void CheckStack(NSStackView *stack,NSView *root) {
 NSRect bounds=root.bounds;
 for(NSView *view in stack.arrangedSubviews) if(!view.hidden) {
  NSRect frame=[view convertRect:view.bounds toView:root];
  if(NSMinX(frame)<-1 || NSMinY(frame)<-1 || NSMaxX(frame)>bounds.size.width+1 || NSMaxY(frame)>bounds.size.height+1 || frame.size.height<1){fprintf(stderr,"layout: %s bounds %s\n",NSStringFromRect(frame).UTF8String,NSStringFromRect(bounds).UTF8String);exit(4);}
  if([view isKindOfClass:NSStackView.class])CheckStack((NSStackView *)view,root);
  if([view isKindOfClass:NSButton.class] && frame.size.width+1<view.fittingSize.width)exit(11);
 }
}
static void Uninstall(InstallerDelegate *delegate,BOOL remove,BOOL cancel) {
 [delegate uninstall:nil];
 NSDate *end=[NSDate dateWithTimeIntervalSinceNow:5];
 while(!delegate.uninstallAlert.window.sheetParent && [end timeIntervalSinceNow]>0)[NSRunLoop.currentRunLoop runUntilDate:[NSDate dateWithTimeIntervalSinceNow:0.02]];
 if(!delegate.confirmationOpen || delegate.cleanupButton.state!=NSControlStateValueOff || delegate.cleanupButton.window==delegate.window || !delegate.cleanupButton.enabled)exit(9);
 [delegate.uninstallAlert.window.contentView layoutSubtreeIfNeeded];
 delegate.cleanupButton.state=remove?NSControlStateValueOn:NSControlStateValueOff;
 [NSApp endSheet:delegate.uninstallAlert.window returnCode:cancel?NSAlertSecondButtonReturn:NSAlertFirstButtonReturn];
 Drain(delegate);
 if(delegate.cleanupButton.superview || delegate.cleanupButton.state!=NSControlStateValueOff)exit(10);
}
static void Capture(InstallerDelegate *delegate,NSString *name) {
 NSString *dir=NSProcessInfo.processInfo.environment[@"BABEL_UI_EVIDENCE_DIR"];
 if(!dir.length)return;
 NSWindow *window=delegate.window;
 NSView *view=window.contentView;
 [view layoutSubtreeIfNeeded];
 NSRect bounds=view.bounds;
 if(bounds.size.width<2||bounds.size.height<2)return;
 CGFloat scale=MAX(1,window.backingScaleFactor);
 NSBitmapImageRep *rep=[[NSBitmapImageRep alloc] initWithBitmapDataPlanes:NULL pixelsWide:(NSInteger)ceil(bounds.size.width*scale) pixelsHigh:(NSInteger)ceil(bounds.size.height*scale) bitsPerSample:8 samplesPerPixel:4 hasAlpha:YES isPlanar:NO colorSpaceName:NSCalibratedRGBColorSpace bytesPerRow:0 bitsPerPixel:0];
 if(!rep)return;
 rep.size=bounds.size;
 NSGraphicsContext *context=[NSGraphicsContext graphicsContextWithBitmapImageRep:rep];
 if(!context)return;
 // Offscreen content draw, not a window-server screenshot. The appearance block
 // resolves dynamic colors; the fill keeps the bitmap background opaque.
 [window.effectiveAppearance performAsCurrentDrawingAppearance:^{
  [NSGraphicsContext saveGraphicsState];
  [NSGraphicsContext setCurrentContext:context];
  [[NSColor windowBackgroundColor] setFill];
  NSRectFill(bounds);
  [view displayRectIgnoringOpacity:bounds inContext:context];
  [NSGraphicsContext restoreGraphicsState];
 }];
 NSData *png=[rep representationUsingType:NSBitmapImageFileTypePNG properties:@{}];
 if(!png.length)return;
 NSString *label=NSProcessInfo.processInfo.environment[@"BABEL_TEST_LABEL"]?:@"state";
 [png writeToFile:[dir stringByAppendingPathComponent:[NSString stringWithFormat:@"%@-%@.png",label,name]] atomically:YES];
}
static BOOL Shown(NSView *view){for(NSView *item=view;item;item=item.superview)if(item.hidden)return NO;return YES;}
static void CheckText(InstallerDelegate *delegate,NSTextField *field,NSString *name) {
 if(!Shown(field)||!field.stringValue.length)return;
 CGFloat measured=[delegate heightForText:field.stringValue font:field.font width:MAX(1,field.bounds.size.width)];
 if(field.bounds.size.height+1<measured){fprintf(stderr,"clipped %s frame %.1f measured %.1f\n",name.UTF8String,field.bounds.size.height,measured);exit(16);}
}
static void Record(InstallerDelegate *delegate,NSMutableArray *states,NSString *state,NSString *expected) {
 Drain(delegate);
 if(![delegate.statusLabel.stringValue isEqualToString:L(expected,nil)]){fprintf(stderr,"state %s: %s != %s\n",state.UTF8String,delegate.statusLabel.stringValue.UTF8String,L(expected,nil).UTF8String);exit(3);}
 NSRect bounds=delegate.window.contentView.bounds;
 CheckStack(delegate.stack,delegate.window.contentView);
 CheckText(delegate,delegate.statusLabel,@"status");CheckText(delegate,delegate.statusNext,@"next");CheckText(delegate,delegate.noteLabel,@"note");
 if(delegate.detailsContainer.hidden && fabs(delegate.window.contentMinSize.height-delegate.window.contentMaxSize.height)>0.5){fprintf(stderr,"collapsed limits %.1f %.1f\n",delegate.window.contentMinSize.height,delegate.window.contentMaxSize.height);exit(23);}
 if(delegate.cleanupButton.window==delegate.window)exit(12);
 if([@[@"ready",@"readyExpanded",@"installed",@"permission",@"permissionStill",@"cleanupWarning"] containsObject:state])Capture(delegate,state);
 // NSTextView.string is the live text storage. Copy it or every recorded state aliases the final value.
 NSString *details=delegate.details.string.length?[NSString stringWithString:delegate.details.string]:@"";
 [states addObject:@{@"state":state,@"status":delegate.statusLabel.stringValue,@"next":delegate.statusNext.stringValue?:@"",@"symbol":delegate.statusSymbolName?:@"",@"tone":delegate.statusTone?:@"",@"closeDefault":@(delegate.closeIsDefault),@"closeTitle":delegate.closeButton.title,@"closeKey":delegate.closeButton.keyEquivalent?:@"",@"note":delegate.noteLabel.stringValue,@"details":details,@"detailsCollapsed":@(delegate.detailsContainer.hidden),@"recoveryVisible":[NSNumber numberWithBool:!delegate.chooseButton.hidden],@"width":@(bounds.size.width),@"height":@(bounds.size.height)}];
}
int main(int argc,const char *argv[]) { @autoreleasepool {
 BabelSetTestActivity(1);
 [NSApplication sharedApplication];[NSApp setActivationPolicy:NSApplicationActivationPolicyRegular];
 NSString *appearance=NSProcessInfo.processInfo.environment[@"BABEL_TEST_APPEARANCE"];
 NSApp.appearance=[NSAppearance appearanceNamed:[appearance isEqualToString:@"dark"]?NSAppearanceNameDarkAqua:NSAppearanceNameAqua];
 InstallerDelegate *delegate=[InstallerDelegate new];[delegate applicationDidFinishLaunching:[NSNotification notificationWithName:NSApplicationDidFinishLaunchingNotification object:NSApp]];
 // Run the same display cycle as a normally launched app before testing actions.
 [NSTimer scheduledTimerWithTimeInterval:0.25 repeats:NO block:^(NSTimer *timer){
 NSMutableArray *states=[NSMutableArray array];NSString *base=delegate.base;
 Record(delegate,states,@"ready",@"common.ready");
 if(!delegate.detailsContainer.hidden || !delegate.chooseButton.hidden || !delegate.recoveryRow.hidden || delegate.cleanupButton.superview)exit(13);
 delegate.disclosureButton.state=NSControlStateValueOn;[delegate toggleDetails:nil];Record(delegate,states,@"readyExpanded",@"common.ready");
 delegate.disclosureButton.state=NSControlStateValueOff;[delegate toggleDetails:nil];Record(delegate,states,@"readyCollapsed",@"common.ready");
 [delegate install:nil];Record(delegate,states,@"installed",@"common.installed");
 Uninstall(delegate,YES,YES);Record(delegate,states,@"uninstallCanceled",@"common.installed");
 Uninstall(delegate,NO,NO);Record(delegate,states,@"uninstallKeep",@"common.uninstalled");
 if(![NSFileManager.defaultManager fileExistsAtPath:[base stringByAppendingPathComponent:@"discord-translator-mod/settings.json"]])exit(5);
 for(NSString *file in @[@"settings.json",@"api-keys.json",@"cache.json"]) {
  NSString *kept=[NSString stringWithContentsOfFile:[[base stringByAppendingPathComponent:@"discord-translator-mod"] stringByAppendingPathComponent:file] encoding:NSUTF8StringEncoding error:nil];
  if(![kept isEqualToString:@"{\"fixture\":true}"])exit(14);
 }
 NSString *restored=[NSString stringWithContentsOfFile:[base stringByAppendingPathComponent:@"app-1.0.0/modules/discord_desktop_core/index.js"] encoding:NSUTF8StringEncoding error:nil];
 if(![restored containsString:@"other-injector.js"] || [restored containsString:@"DiscordTranslatorMod"])exit(15);
 [delegate install:nil];Drain(delegate);Uninstall(delegate,YES,NO);Record(delegate,states,@"uninstallErase",@"common.uninstalled");
 if([NSFileManager.defaultManager fileExistsAtPath:[base stringByAppendingPathComponent:@"discord-translator-mod"]])exit(6);
 [delegate install:nil];Drain(delegate);
 NSString *index=[base stringByAppendingPathComponent:@"app-1.0.0/modules/discord_desktop_core/index.js"];
 [NSFileManager.defaultManager removeItemAtPath:index error:nil];[NSFileManager.defaultManager createDirectoryAtPath:index withIntermediateDirectories:NO attributes:nil error:nil];
 [delegate run:NO removeData:NO];Record(delegate,states,@"partial",@"common.uninstallFailed");
 delegate.base=[base stringByAppendingPathComponent:@"missing"];[delegate detectTarget:nil];Record(delegate,states,@"missing",@"common.error.targetMissing");
 delegate.disclosureButton.state=NSControlStateValueOn;[delegate toggleDetails:nil];Record(delegate,states,@"missingExpanded",@"common.error.targetMissing");
 if(delegate.chooseButton.hidden || delegate.cleanupButton.enabled)exit(7);
 delegate.disclosureButton.state=NSControlStateValueOff;[delegate toggleDetails:nil];
 delegate.base=NSProcessInfo.processInfo.environment[@"BABEL_TEST_DENIED_DIR"];[delegate detectTarget:nil];Record(delegate,states,@"permission",@"mac.permissionSummary");
 delegate.disclosureButton.state=NSControlStateValueOn;[delegate toggleDetails:nil];Record(delegate,states,@"permissionExpanded",@"mac.permissionSummary");
 if(delegate.chooseButton.hidden)exit(8);
 [delegate useChosenFolder:[NSURL fileURLWithPath:NSProcessInfo.processInfo.environment[@"BABEL_TEST_DENIED_DIR"]]];
 Record(delegate,states,@"permissionStill",@"mac.permissionSummary");
 if(![delegate.statusNext.stringValue isEqualToString:L(@"mac.permissionStill",nil)]||![delegate.statusTone isEqualToString:@"failure"]||![delegate.statusSymbolName isEqualToString:@"xmark.octagon.fill"]||delegate.chooseButton.hidden||delegate.recoveryRow.hidden)exit(17);
 // A mode-000 directory is a chmod failure. It does not prove a macOS privacy consent prompt.
 [NSFileManager.defaultManager removeItemAtPath:index error:nil];
 [@"require('./other-injector.js');\nmodule.exports = require('./core.asar');\n" writeToFile:index atomically:YES encoding:NSUTF8StringEncoding error:nil];
 NSString *link=[[index stringByDeletingLastPathComponent] stringByAppendingPathComponent:@"discord-translator-mod-g-n-1-0123456789abcdef"];
 [NSFileManager.defaultManager createSymbolicLinkAtPath:link withDestinationPath:@"/tmp" error:nil];
 delegate.base=base;delegate.pathLabel.stringValue=base;[delegate detectTarget:nil];Drain(delegate);
 if(!delegate.validTarget)exit(24);
 [delegate install:nil];Record(delegate,states,@"cleanupWarning",@"common.installed");
 if(![delegate.statusTone isEqualToString:@"warning"]||![delegate.statusSymbolName isEqualToString:@"exclamationmark.triangle.fill"]||[delegate.statusNext.stringValue rangeOfString:L(@"common.cleanupLeftover",nil)].location==NSNotFound||!delegate.closeIsDefault)exit(19);
 [NSFileManager.defaultManager removeItemAtPath:link error:nil];
 // Restart fixture states. The seams fake identity, quit, launch and the
 // installer exit, so no fixture resolves, quits or opens a real Discord.
 BabelTestRestartBundleID=^NSString *(NSString *folder){return @"com.example.DiscordFixture";};
 [delegate install:nil];Record(delegate,states,@"restartArmed",@"common.installed");
 if(![delegate.closeButton.title isEqualToString:L(@"mac.restart",nil)]||![delegate.closeButton.keyEquivalent isEqualToString:@"\r"]||!delegate.closeIsDefault)exit(25);
 BabelTestRestartQuit=^BOOL(NSString *bid){return NO;};
 [delegate restartDiscord:nil];Drain(delegate);Record(delegate,states,@"restartNotQuit",@"common.restartFailed");
 if(![delegate.closeButton.title isEqualToString:L(@"mac.restart",nil)]||!delegate.closeButton.enabled||![delegate.statusNext.stringValue isEqualToString:L(@"mac.restartSteps",nil)])exit(26);
 if([delegate.details.string rangeOfString:L(@"common.detail.notQuit",nil)].location==NSNotFound)exit(30);
 BabelTestRestartQuit=^BOOL(NSString *bid){return YES;};
 BabelTestRestartLaunch=^BOOL(NSString *bid){return NO;};
 [delegate restartDiscord:nil];Drain(delegate);Record(delegate,states,@"restartLaunchFailed",@"common.restartFailed");
 if(![delegate.statusNext.stringValue isEqualToString:L(@"mac.openManually",nil)]||![delegate.closeButton.title isEqualToString:L(@"mac.restart",nil)])exit(27);
 if([delegate.details.string rangeOfString:L(@"common.detail.launchFailed",nil)].location==NSNotFound)exit(31);
 __block BOOL exited=NO;
 BabelTestRestartExit=^{exited=YES;};
 BabelTestRestartLaunch=^BOOL(NSString *bid){return YES;};
 [delegate restartDiscord:nil];Drain(delegate);
 if(!exited)exit(28);
 // Clearing states: another folder, a failed install and an uninstall all
 // return the button to Close. The failure is a broken core index, so the
 // idempotent install path cannot mask it.
 [delegate useChosenFolder:[NSURL fileURLWithPath:base]];Record(delegate,states,@"restartClearedByFolder",@"common.ready");
 if(![delegate.closeButton.title isEqualToString:L(@"mac.close",nil)])exit(29);
 [NSFileManager.defaultManager removeItemAtPath:index error:nil];
 [NSFileManager.defaultManager createDirectoryAtPath:index withIntermediateDirectories:NO attributes:nil error:nil];
 [delegate install:nil];Drain(delegate);Record(delegate,states,@"restartClearedByFailure",@"common.installFailed");
 if(![delegate.closeButton.title isEqualToString:L(@"mac.close",nil)])exit(32);
 [NSFileManager.defaultManager removeItemAtPath:index error:nil];
 [@"require('./other-injector.js');\nmodule.exports = require('./core.asar');\n" writeToFile:index atomically:YES encoding:NSUTF8StringEncoding error:nil];
 [delegate install:nil];Drain(delegate);
 if(![delegate.closeButton.title isEqualToString:L(@"mac.restart",nil)])exit(33);
 [delegate run:NO removeData:NO];Record(delegate,states,@"restartClearedByUninstall",@"common.uninstalled");
 if(![delegate.closeButton.title isEqualToString:L(@"mac.close",nil)])exit(34);
 NSDictionary *result=@{@"title":delegate.window.title,@"install":delegate.installButton.title,@"uninstall":delegate.uninstallButton.title,@"close":delegate.closeButton.title,@"choose":delegate.chooseButton.title,@"cleanup":delegate.cleanupButton.title,@"disclosure":delegate.disclosureButton.accessibilityLabel,@"exitRequested":@(exited),@"states":states};
 NSData *data=[NSJSONSerialization dataWithJSONObject:result options:0 error:nil];[data writeToFile:NSProcessInfo.processInfo.environment[@"BABEL_TEST_UI_RESULT"] atomically:YES];[delegate.window close];[NSApp terminate:nil];
 }];[NSApp run];return 0;
} }
`;
const cases=["en","zh-Hans","zh-Hant","ja"].flatMap(locale=>["light","dark"].map(appearance=>({locale,appearance,pseudo:false}))).concat({locale:"en",appearance:"light",pseudo:true});
for(const {locale,appearance,pseudo} of cases){
 test(`AppKit ${locale} ${appearance}${pseudo?" pseudo":""}: localized fixture states and intrinsic layout`,{skip:process.platform!=="darwin"||process.env.BABEL_NATIVE_UI_TEST!=="1"},t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),"babel-native-i18n-"));let denied;
  t.after(()=>{if(denied)fs.chmodSync(denied,0o700);fs.rmSync(dir,{recursive:true,force:true});});
  const app=path.join(dir,"Babel Locale Test.app"),contents=path.join(app,"Contents"),resources=path.join(contents,"Resources"),binary=path.join(contents,"MacOS/Babel Locale Test"),source=path.join(dir,"driver.m");
  fs.mkdirSync(path.dirname(binary),{recursive:true});fs.mkdirSync(resources,{recursive:true});
  fs.writeFileSync(path.join(contents,"Info.plist"),require("../scripts/build").plist("Babel Locale Test","0.1.6"));
  for(const folder of ["en","zh-Hans","zh-Hant","ja"])fs.cpSync(path.join(root,`installer/macos/Resources/${folder}.lproj`),path.join(resources,`${folder}.lproj`),{recursive:true});
  const expanded=value=>`⟦${value}${"~".repeat(Math.ceil(value.length*.4))}⟧`;
  if(pseudo){const raw=JSON.parse(fs.readFileSync(path.join(root,"i18n/messages/en.json")));const strings=Object.entries(raw).filter(([id])=>/^(mac|common)\./.test(id)).map(([id,entry])=>`${JSON.stringify(id)} = ${JSON.stringify(expanded(entry.message))};`).join("\n")+"\n";fs.writeFileSync(path.join(resources,"en.lproj/Localizable.strings"),strings);}
  const base=path.join(dir,"discord"),core=path.join(base,"app-1.0.0/modules/discord_desktop_core");fs.mkdirSync(core,{recursive:true});
  for(const [file,value] of [["core.asar","core"],["package.json","{}"],["index.js","require('./other-injector.js');\nmodule.exports = require('./core.asar');\n"]])fs.writeFileSync(path.join(core,file),value);
  fs.mkdirSync(path.join(base,"discord-translator-mod"));for(const file of ["settings.json","api-keys.json","cache.json"])fs.writeFileSync(path.join(base,"discord-translator-mod",file),"{\"fixture\":true}");
  denied=path.join(dir,"denied");fs.mkdirSync(denied);fs.chmodSync(denied,0);
  require("../scripts/lib/payload").emitPayload(path.join(resources,"payload"));fs.writeFileSync(source,driver);
  cp.execFileSync("/usr/bin/clang",["-fobjc-arc","-DBABEL_INSTALL_TEST","-framework","Cocoa","-I",path.join(root,"installer/macos"),source,path.join(root,"installer/macos/BabelInstallerCore.m"),"-o",binary]);
  const resultFile=path.join(dir,"result.json");
  cp.execFileSync("/usr/bin/codesign",["--force","--deep","--sign","-",app],{stdio:"pipe"});
  const evidence=process.env.BABEL_UI_EVIDENCE_DIR;if(evidence)fs.mkdirSync(evidence,{recursive:true});
  try { cp.execFileSync(binary,["-AppleLanguages",`(${locale})`],{env:{...process.env,BABEL_TEST_BASE_DIR:base,BABEL_TEST_DENIED_DIR:denied,BABEL_TEST_UI_RESULT:resultFile,BABEL_TEST_APPEARANCE:appearance,BABEL_TEST_LABEL:`${locale}-${appearance}${pseudo?"-pseudo":""}`,BABEL_UI_EVIDENCE_DIR:evidence||""},timeout:60000,stdio:"pipe"}); } catch(error) { throw new Error(`Native probe exit ${error.status}, signal ${error.signal}: ${error.stderr}`); }
  const result=JSON.parse(fs.readFileSync(resultFile)),catalog=JSON.parse(fs.readFileSync(path.join(root,`i18n/messages/${locale}.json`))),message=id=>pseudo?expanded(catalog[id].message):locale==="en"?catalog[id].message:catalog[id];
  if(evidence)fs.writeFileSync(path.join(evidence,`${locale}-${appearance}${pseudo?"-pseudo":""}.json`),JSON.stringify(result,null,2)+"\n");
  assert.equal(result.disclosure,message("mac.details"));
  for(const id of ["title","install","uninstall","close","chooseFolder","cleanup"])assert.equal(result[id==="chooseFolder"?"choose":id],message(`mac.${id}`));
  assert.deepEqual(result.states.map(x=>x.state),["ready","readyExpanded","readyCollapsed","installed","uninstallCanceled","uninstallKeep","uninstallErase","partial","missing","missingExpanded","permission","permissionExpanded","permissionStill","cleanupWarning","restartArmed","restartNotQuit","restartLaunchFailed","restartClearedByFolder","restartClearedByFailure","restartClearedByUninstall"]);
  for(const state of result.states){assert.doesNotMatch(state.status,/\{\w+\}|^(?:common|mac)\./);assert.ok(state.width>=480&&state.height>=120,state.state);}
  assert.equal(result.states[0].detailsCollapsed,true);assert.equal(result.states[1].detailsCollapsed,false);assert.equal(result.states[2].detailsCollapsed,true);
  assert.ok(result.states[1].height>result.states[0].height);assert.ok(Math.abs(result.states[2].height-result.states[0].height)<1);
  if(!pseudo)assert.ok(result.states[0].height<400);
  const byName=Object.fromEntries(result.states.map(state=>[state.state,state]));
  assert.equal(byName.ready.next,message("common.readyNext"));assert.equal(byName.ready.symbol,"");assert.equal(byName.ready.recoveryVisible,false);
  assert.equal(byName.installed.symbol,"checkmark.circle.fill");assert.equal(byName.installed.tone,"success");assert.equal(byName.installed.closeDefault,true);
  assert.equal(byName.installed.next,message("mac.restartSteps"));
  assert.equal(byName.partial.closeDefault,false);assert.equal(byName.partial.tone,"failure");assert.equal(byName.partial.symbol,"xmark.octagon.fill");
  assert.equal(byName.permission.recoveryVisible,true);assert.equal(byName.permission.tone,"warning");assert.equal(byName.permission.symbol,"exclamationmark.triangle.fill");
  assert.equal(byName.permission.next,message("mac.permissionNext"));
  const system=message("common.systemMessage").split("{message}")[0].trim();
  assert.ok(byName.permission.details.includes(system),byName.permission.details);
  assert.doesNotMatch(byName.permission.details,/Privacy|System Settings|隐私|隱私|プライバシー|系统设置|系統設定|システム設定/);
  assert.equal(byName.permissionStill.next,message("mac.permissionStill"));assert.equal(byName.permissionStill.tone,"failure");assert.equal(byName.permissionStill.recoveryVisible,true);
  assert.ok(byName.permissionStill.details.includes(system),byName.permissionStill.details);
  assert.equal(byName.cleanupWarning.tone,"warning");assert.equal(byName.cleanupWarning.closeDefault,true);
  assert.ok(byName.cleanupWarning.next.includes(message("common.cleanupLeftover")));
  assert.ok(byName.cleanupWarning.details.includes(message("common.detail.payloadKept")));
  assert.equal(result.exitRequested,true);
  assert.equal(byName.restartArmed.closeTitle,message("mac.restart"));assert.equal(byName.restartArmed.closeKey,"\r");assert.equal(byName.restartArmed.closeDefault,true);
  assert.equal(byName.restartArmed.next,message("common.restartNext"));
  assert.equal(byName.restartNotQuit.status,message("common.restartFailed"));assert.equal(byName.restartNotQuit.next,message("mac.restartSteps"));
  assert.equal(byName.restartNotQuit.closeTitle,message("mac.restart"));assert.equal(byName.restartNotQuit.closeDefault,true);
  assert.ok(byName.restartNotQuit.details.includes(message("common.detail.notQuit")));
  assert.equal(byName.restartLaunchFailed.next,message("mac.openManually"));
  assert.ok(byName.restartLaunchFailed.details.includes(message("common.detail.launchFailed")));
  assert.equal(byName.restartClearedByFolder.closeTitle,message("mac.close"));assert.equal(byName.restartClearedByFolder.status,message("common.ready"));
  assert.equal(byName.restartClearedByFailure.closeTitle,message("mac.close"));assert.equal(byName.restartClearedByFailure.status,message("common.installFailed"));
  assert.equal(byName.restartClearedByUninstall.closeTitle,message("mac.close"));assert.equal(byName.restartClearedByUninstall.status,message("common.uninstalled"));
 });
}
