#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN

BOOL BabelInstall(NSString *discordBaseDir, NSString *payloadSource, NSError **error);
BOOL BabelUninstall(NSString *discordBaseDir, NSError **error);
BOOL BabelTargetValid(NSString *discordBaseDir, NSError **error);
NSString *BabelProfileState(NSString *discordBaseDir);
BOOL BabelUninstallWithOptions(NSString *discordBaseDir, BOOL removeProfileData, NSString *profileDirectory, NSMutableArray<NSDictionary *> *steps, NSError **error);
// The owning application bundle identifier, only for a data folder that maps to
// a channel whose identifier the installed Info.plist has verified. Custom and
// unverified folders return nil and keep manual restart instructions.
NSString *_Nullable BabelChannelBundleID(NSString *discordBaseDir);
NSString *_Nullable BabelChannelBundleIDForHome(NSString *discordBaseDir, NSString *home);

#if BABEL_INSTALL_TEST
void BabelSetTestActivity(int mode);
void BabelSetInstallHook(BOOL (*hook)(NSString *step, NSString *path));
#endif

NS_ASSUME_NONNULL_END
