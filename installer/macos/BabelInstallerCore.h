#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN

BOOL BabelInstall(NSString *discordBaseDir, NSString *payloadSource, NSError **error);
BOOL BabelUninstall(NSString *discordBaseDir, NSError **error);

NS_ASSUME_NONNULL_END
