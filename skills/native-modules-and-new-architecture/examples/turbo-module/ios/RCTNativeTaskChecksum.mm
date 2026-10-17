// modules/task-checksum/ios/RCTNativeTaskChecksum.mm
// Implements the generated NativeTaskChecksumSpec protocol: a renamed or missing method is a
// compile error, which is what codegen buys over a hand-written contract.
#import "RCTNativeTaskChecksum.h"

#include "../cpp/task-checksum.h"

@implementation RCTNativeTaskChecksum

- (NSString *)checksum:(NSString *)text
{
  // The explicit length keeps an embedded NUL (U+0000): std::string(const char *) would stop there,
  // while Android hands the C++ the full UTF-8 byte array, and the digests would differ.
  const char *bytes = [text UTF8String];
  std::string input(bytes, [text lengthOfBytesUsingEncoding:NSUTF8StringEncoding]);
  std::string result = taskchecksum::checksum(input);
  return [NSString stringWithUTF8String:result.c_str()];
}

- (std::shared_ptr<facebook::react::TurboModule>)getTurboModule:
    (const facebook::react::ObjCTurboModule::InitParams &)params
{
  return std::make_shared<facebook::react::NativeTaskChecksumSpecJSI>(params);
}

+ (NSString *)moduleName
{
  return @"NativeTaskChecksum";
}

@end
