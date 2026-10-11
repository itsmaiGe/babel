"use strict";
const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path"),os=require("node:os"),cp=require("node:child_process");
const {generate,outputs,validateCatalogs,LOCALES}=require("../scripts/lib/i18n");
const {TRANSLATION_LANGUAGES,TRANSLATION_STYLE_PRESETS,DEFAULT_TRANSLATION_PROMPT}=require("../src/shared/defaults");
const {resolveUiLocale}=require("../src/shared/ui-locale");
const i18n=require("../src/mod/ui/i18n/index");
const {MESSAGES,REASONS,publicFailure,sanitizeError}=require("../src/mod/core/errors");
const catalogs=()=>Object.fromEntries(LOCALES.map(locale=>[locale,JSON.parse(fs.readFileSync(path.join(__dirname,`../i18n/messages/${locale}.json`)))]));
const fixtures=require("../i18n/locale-cases.json");
test("generated catalogs are fresh, deterministic, and surface-scoped",()=>{
 const generated=generate({check:true});assert.deepEqual([...generated],[...generate({check:true})]);
 const raw=catalogs();assert.deepEqual([...outputs(raw,TRANSLATION_LANGUAGES,fixtures)],[...outputs(raw,TRANSLATION_LANGUAGES,fixtures)]);
 for(const locale of LOCALES){for(const id of Object.keys(i18n.__test.catalogs[locale]))assert.match(id,/^(plugin|common)\./);}
});
for(const [name,mutate] of [
 ["ID mismatch",c=>delete c.ja["plugin.save"]],
 ["parameter mismatch",c=>c.ja["plugin.percent"]="{unknown}%"],
 ["empty message",c=>c.ja["plugin.save"]=" "],
 ["markup",c=>c.ja["plugin.save"]="<b>Save</b>"],
 ["printf placeholder",c=>c.ja["plugin.save"]="Save %@"],
 ["missing mnemonic",c=>c.ja["win.close"]="Close"],
 ["duplicate mnemonic",c=>c.ja["win.close"]="&Install"],
 ["extra language label",c=>{for(const locale of LOCALES)c[locale]["plugin.lang.extra"]=locale==="en"?{message:"Extra",description:"Extra language"}:"Extra";}],
 ["missing description",c=>c.en["plugin.save"].description=""],
])test(`generator rejects ${name}`,()=>{const raw=catalogs();mutate(raw);assert.throws(()=>validateCatalogs(raw,TRANSLATION_LANGUAGES));});
test("generator accepts literal percent and rejects missing language table IDs",()=>{
 validateCatalogs(catalogs(),TRANSLATION_LANGUAGES);assert.throws(()=>validateCatalogs(catalogs(),TRANSLATION_LANGUAGES.concat({id:"extra"})));
});
for(const [index,fixture] of fixtures.entries())test(`JS locale fixture ${index}: ${JSON.stringify(fixture.preferences)}`,()=>assert.equal(resolveUiLocale(fixture.preferences),fixture.expectedJSGo));
test("legacy interface language values are dropped and independent of translation targets",()=>{
 const {normalizeSettings}=require("../src/shared/settings");
 assert.equal(Object.hasOwn(normalizeSettings({}),"uiLanguage"),false);
 assert.equal(Object.hasOwn(normalizeSettings({uiLanguage:"xx"}),"uiLanguage"),false);
 const base=normalizeSettings({model:{targetLanguage:"custom {lang}",sendLanguage:"英语",modelId:"my/model"},customPrompt:"Keep {{targetLanguage}}\n字节 unchanged",style:{fontFamily:"user font",textColor:"#123456"}});
 for(const locale of LOCALES){const next=normalizeSettings({...base,uiLanguage:locale});assert.deepEqual(next,base);}
 assert.equal(require("../src/shared/defaults").DEFAULT_TRANSLATION_PROMPT,DEFAULT_TRANSLATION_PROMPT);
});
test("lookup is single-pass, formats numbers, and has a terminal fallback",()=>{
 for(const locale of LOCALES){i18n.setLocale(locale);assert.equal(i18n.t("plugin.key.savedPlaceholder",{preview:"{secret}"}).includes("{secret}"),true);assert.equal(i18n.t("does.not.exist"),i18n.t("common.unavailable"));assert.equal(i18n.t("plugin.percent",{}),i18n.t("common.unavailable"));assert.ok(i18n.t("plugin.modelsRefreshed",{count:12345}).includes(new Intl.NumberFormat(locale).format(12345)));}
 i18n.setLocale("en");
});
test("every plugin error and recovery reason resolves, and diagnostics are never rendered",()=>{
 for(const locale of LOCALES){i18n.setLocale(locale);for(const code of Object.keys(MESSAGES)){for(const reason of [undefined,...(REASONS[code]||[])]){const error={code,reason,params:{limit:12000,status:429,origin:"https://example.invalid"},message:"private-key prompt response body"};const value=i18n.errorText(error);assert.ok(value.trim());assert.doesNotMatch(value,/private-key|prompt response|plugin\.error|\{(?:limit|origin)\}/);assert.notEqual(value,i18n.t("common.unavailable"));}}assert.equal(i18n.errorText(new Error("sensitive")),i18n.t("plugin.error.UNKNOWN"));}
 i18n.setLocale("en");
});
test("error envelope drops secrets, URLs, free text, unknown reasons and wrong types",()=>{
 const safe=sanitizeError({code:"AUTH",reason:"invented",params:{status:401,origin:"https://user:secret@example.invalid/path?key=private",key:"private",prompt:"private",body:"private",url:"https://example.invalid"},message:"private"});assert.deepEqual(safe.params,{status:401});assert.equal(safe.reason,undefined);assert.doesNotMatch(JSON.stringify(safe),/private/);
 assert.deepEqual(sanitizeError({code:"INPUT",reason:"TEXT_LIMIT",params:{limit:12000}}).params,{limit:12000});
 assert.equal(sanitizeError({code:"INPUT",reason:"TEXT_LIMIT",params:{limit:"12000",origin:"https://example.invalid"}}).params,undefined);
 assert.equal(publicFailure(new Error("secret")).error.code,"UNKNOWN");
});
test("all plugin state text and option tables are complete in each locale",()=>{
 const raw=catalogs(),params={count:12,size:40,value:80,language:"English",preview:"sk-…abcd",origin:"https://example.invalid",version:"0.1.6",message:"OS diagnostic",limit:12000,path:"/temporary/discord",provider:"Ollama",supporterA:"Lallen 女士",supporterB:"Silva 先生",status:429};
 for(const locale of LOCALES){i18n.setLocale(locale);for(const id of Object.keys(i18n.__test.catalogs[locale])){const value=i18n.t(id,params);assert.ok(value.trim(),id);assert.doesNotMatch(value,/\{(?:count|size|preview|path|message|value|limit)\}/,id);}
 for(const preset of TRANSLATION_STYLE_PRESETS)assert.ok(raw[locale][`plugin.style.${preset.value}`]);
 const thanks=i18n.t("plugin.about.thanks",params);assert.match(thanks,/Lallen 女士/);assert.match(thanks,/Silva 先生/);}
 i18n.setLocale("en");
});
test("test-only pseudo locale marks app copy and expands without shipping",t=>{
 const pseudo=Object.fromEntries(Object.entries(i18n.__test.catalogs.en).map(([id,value])=>[id,`⟦${value}${"~".repeat(Math.ceil(value.length*.4))}⟧`]));
 i18n.setLocale("en");i18n.__test.setTestCatalog(pseudo);
 for(const id of Object.keys(pseudo))assert.ok(i18n.t(id,{count:1,size:3,value:80,language:"English",preview:"masked",origin:"https://example.invalid",version:"0.1.6",message:"Diagnostic",limit:12000,path:"fixture",provider:"Ollama",supporterA:"Lallen 女士",supporterB:"Silva 先生",status:429}).startsWith("⟦"),id);
 i18n.setLocale("en");const dir=fs.mkdtempSync(path.join(os.tmpdir(),"babel-pseudo-"));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));const payload=require("../scripts/lib/payload").emitPayload(dir);
 assert.equal(payload.version,"0.1.6");
});
test("translation domain and runtime cores do not import localization",()=>{
 const files=["src/shared/translate.js","src/shared/language.js",...fs.readdirSync(path.join(__dirname,"../src/mod/core")).filter(x=>x.endsWith(".js")).map(x=>`src/mod/core/${x}`)];
 for(const file of files)assert.doesNotMatch(fs.readFileSync(path.join(__dirname,"..",file),"utf8"),/require\([^\n]*(?:i18n|ui-locale)/,file);
});
test("retired settings ids are absent from catalogs and plugin source",()=>{
 const retired=["plugin.section.send","plugin.persistCache","plugin.cachePending","plugin.cacheStatus","plugin.cacheMemory","plugin.update.download","plugin.color.backgroundAuto","plugin.color.textAuto","plugin.uiLanguage","plugin.systemLanguage","plugin.about.author","plugin.about.follow"];
 const raw=catalogs();
 for(const id of retired)for(const locale of LOCALES)assert.equal(raw[locale][id],undefined,`${locale} ${id}`);
 const root=path.join(__dirname,"..");
 const files=[];
 const visit=dir=>{for(const entry of fs.readdirSync(dir,{withFileTypes:true})){if(entry.name==="node_modules"||entry.name==="dist"||entry.name==="payload")continue;const full=path.join(dir,entry.name);if(entry.isDirectory())visit(full);else if(/\.(js|json)$/.test(entry.name))files.push(full);}};
 visit(path.join(root,"src"));visit(path.join(root,"i18n"));
 for(const file of files){const text=fs.readFileSync(file,"utf8");for(const id of retired)assert.equal(text.includes(`"${id}"`)||text.includes(`'${id}'`),false,`${file} ${id}`);}
 assert.equal(fs.readFileSync(path.join(root,"src/mod/main.js"),"utf8").includes("setPersistence"),false);
 assert.equal(fs.readFileSync(path.join(root,"src/mod/core/cache-store.js"),"utf8").includes("setPersistence"),false);
});
test("literal catalog references are covered; bridge has no owned fallback copy",()=>{
 const raw=catalogs().en;
 for(const file of ["src/mod/renderer.js","installer/macos/InstallerWindow.m","installer/macos/BabelInstallerCore.m","installer/internal/ui/window_windows.go","installer/internal/ui/messages.go","installer/internal/core/core.go","installer/internal/core/publish.go","installer/internal/core/lock_unix.go","installer/internal/core/lock_windows.go"]){
 const source=fs.readFileSync(path.join(__dirname,"..",file),"utf8");for(const match of source.matchAll(/["']((?:plugin|mac|win|common)\.[\w.]+)["']/g))assert.ok(raw[match[1]],`${file}: ${match[1]}`);
 }
 const preload=fs.readFileSync(path.join(__dirname,"../src/mod/preload.js"),"utf8");assert.doesNotMatch(preload,/throw new Error\("[^"\n]*[\p{Script=Han}]/u);assert.doesNotMatch(preload,/placeholder: "[^"\n]+"|helperText:"[^"\n]+"|aria-label": "[^"\n]+"/);
});
test("packaged nested localization imports load from the actual emitted payload",t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),"babel-i18n-payload-"));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));const manifest=require("../scripts/lib/payload").emitPayload(dir);
 for(const locale of LOCALES)assert.ok(manifest.files.some(entry=>entry.path===`ui/i18n/messages/${locale}.js`));
 const packaged=require(path.join(dir,"ui/i18n/index.js"));for(const locale of LOCALES){packaged.setLocale(locale);assert.equal(packaged.t("plugin.save"),i18n.__test.catalogs[locale]["plugin.save"]);}assert.equal(packaged.__test,undefined);
});
test("main caches native system preferences and window construction reads no settings or keys",()=>{
 const main=require("../src/mod/main");let reads=0;main.setElectronForTests({app:{isReady:()=>true,getPreferredSystemLanguages:()=>{reads++;return ["fr-FR","zh-TW"];},getPath:()=>{throw new Error("disk identity access forbidden");}}});
 for(let i=0;i<3;i++){const result=main.patchBrowserWindowOptions({webPreferences:{preload:"/discord/mainScreenPreload.js",additionalArguments:["--dtm-ui-locale=bogus"]}},"/mod/preload.js");assert.deepEqual(result.webPreferences.additionalArguments.filter(arg=>arg.startsWith("--dtm-ui-locale=")),["--dtm-ui-locale=zh-Hant"]);}
 assert.equal(reads,1);main.setElectronForTests(null);
});
test("main unavailable or invalid preferences fall back once per session",()=>{
 const main=require("../src/mod/main"),warn=console.warn;let diagnostics=0;console.warn=()=>diagnostics++;
 try {for(const source of [undefined,[],[17,""],()=>{throw new Error("unavailable")}]){main.setElectronForTests({app:{getPreferredSystemLanguages:typeof source==="function"?source:()=>source}});assert.equal(main.getSystemLocale(),"en");assert.equal(main.getSystemLocale(),"en");}assert.equal(diagnostics,4);} finally{console.warn=warn;main.setElectronForTests(null);}
});
test("Foundation matches all 20 measured fixtures including the recorded yue script exception",{skip:process.platform!=="darwin"},t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),"babel-foundation-locales-"));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));const source=path.join(dir,"probe.m"),binary=path.join(dir,"probe");
 fs.writeFileSync(source,'#import <Foundation/Foundation.h>\nint main(int argc,const char *argv[]){@autoreleasepool{NSArray *cases=[NSJSONSerialization JSONObjectWithData:[NSData dataWithContentsOfFile:[NSString stringWithUTF8String:argv[1]]] options:0 error:nil];NSMutableArray *result=[NSMutableArray array];for(NSDictionary *item in cases)if([item[@"measured"] boolValue])[result addObject:[[NSBundle preferredLocalizationsFromArray:@[@"en",@"zh-Hans",@"zh-Hant",@"ja"] forPreferences:item[@"preferences"]] firstObject]];NSData *data=[NSJSONSerialization dataWithJSONObject:result options:0 error:nil];fwrite(data.bytes,1,data.length,stdout);}}');
 cp.execFileSync("/usr/bin/clang",["-fobjc-arc","-framework","Foundation",source,"-o",binary]);const result=JSON.parse(cp.execFileSync(binary,[path.join(__dirname,"../i18n/locale-cases.json")],{encoding:"utf8"}));const measured=fixtures.filter(item=>item.measured);assert.equal(measured.length,20);assert.deepEqual(result,measured.map(item=>item.expectedAppKit));
});

test("model-facing prompt bytes are identical for every stored interface language value",()=>{
 const {normalizeSettings}=require("../src/shared/settings"),{buildTranslationMessages}=require("../src/shared/translate");
 const settings=normalizeSettings({customPrompt:"Custom {{targetLanguage}}\n{{styleInstruction}}",translationStyle:"custom",model:{targetLanguage:"简体中文",sendLanguage:"英语"}});
 const baseline=JSON.stringify(buildTranslationMessages({text:"literal {braces} 用户内容",direction:"read",settings}));
 for(const legacy of LOCALES)assert.equal(JSON.stringify(buildTranslationMessages({text:"literal {braces} 用户内容",direction:"read",settings:normalizeSettings({...settings,uiLanguage:legacy})})),baseline);
 assert.deepEqual(TRANSLATION_LANGUAGES.map(item=>item.value),["简体中文","繁体中文","英语","日语","韩语","法语","德语","西班牙语","俄语"]);
});
