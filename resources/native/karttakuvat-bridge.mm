/**
 * Native image processing bridge for Karttakuvat.
 *
 * Provides HEIC→JPEG conversion, thumbnail generation, and video frame
 * extraction via ImageIO and AVFoundation — replacing sips/qlmanage subprocesses.
 *
 * Build:
 *   clang++ -shared -fPIC -O2 -fobjc-arc \
 *     -framework Foundation -framework ImageIO \
 *     -framework AVFoundation -framework CoreGraphics \
 *     -o native/libkarttakuvat.dylib native/karttakuvat-bridge.mm
 */

#import <Foundation/Foundation.h>
#import <ImageIO/ImageIO.h>
#import <CoreGraphics/CoreGraphics.h>
#import <CoreMedia/CoreMedia.h>
#import <AVFoundation/AVFoundation.h>

static CFStringRef const kJPEGType = CFSTR("public.jpeg");

// ---------- convertToJpeg ----------

extern "C" int convertToJpeg(const char* inPath, const char* outPath, float quality) {
    @autoreleasepool {
        NSString* input = [NSString stringWithUTF8String:inPath];
        NSString* output = [NSString stringWithUTF8String:outPath];

        NSURL* inputURL = [NSURL fileURLWithPath:input];
        NSURL* outputURL = [NSURL fileURLWithPath:output];

        CGImageSourceRef source = CGImageSourceCreateWithURL((__bridge CFURLRef)inputURL, NULL);
        if (!source) return 1;

        CGImageRef image = CGImageSourceCreateImageAtIndex(source, 0, NULL);
        // Copy source properties (includes EXIF orientation) so the output
        // JPEG retains the correct rotation metadata.
        CFDictionaryRef sourceProps = CGImageSourceCopyPropertiesAtIndex(source, 0, NULL);
        CFRelease(source);
        if (!image) {
            if (sourceProps) CFRelease(sourceProps);
            return 2;
        }

        CGImageDestinationRef dest = CGImageDestinationCreateWithURL(
            (__bridge CFURLRef)outputURL,
            kJPEGType,
            1, NULL
        );
        if (!dest) {
            CGImageRelease(image);
            if (sourceProps) CFRelease(sourceProps);
            return 3;
        }

        NSMutableDictionary* opts = sourceProps
            ? [NSMutableDictionary dictionaryWithDictionary:(__bridge NSDictionary*)sourceProps]
            : [NSMutableDictionary dictionary];
        opts[(__bridge NSString*)kCGImageDestinationLossyCompressionQuality] = @(quality);
        CGImageDestinationAddImage(dest, image, (__bridge CFDictionaryRef)opts);
        if (sourceProps) CFRelease(sourceProps);
        bool ok = CGImageDestinationFinalize(dest);

        CFRelease(dest);
        CGImageRelease(image);
        return ok ? 0 : 4;
    }
}

// ---------- resizeToJpeg ----------

extern "C" int resizeToJpeg(const char* inPath, const char* outPath, int maxDim, float quality) {
    @autoreleasepool {
        NSString* input = [NSString stringWithUTF8String:inPath];
        NSString* output = [NSString stringWithUTF8String:outPath];

        NSURL* inputURL = [NSURL fileURLWithPath:input];
        NSURL* outputURL = [NSURL fileURLWithPath:output];

        CGImageSourceRef source = CGImageSourceCreateWithURL((__bridge CFURLRef)inputURL, NULL);
        if (!source) return 1;

        // Use ImageIO thumbnail generation for efficient downscaling
        NSDictionary* thumbOpts = @{
            (__bridge NSString*)kCGImageSourceThumbnailMaxPixelSize: @(maxDim),
            (__bridge NSString*)kCGImageSourceCreateThumbnailFromImageAlways: @YES,
            (__bridge NSString*)kCGImageSourceCreateThumbnailWithTransform: @YES
        };
        CGImageRef thumbnail = CGImageSourceCreateThumbnailAtIndex(source, 0, (__bridge CFDictionaryRef)thumbOpts);
        CFRelease(source);
        if (!thumbnail) return 2;

        CGImageDestinationRef dest = CGImageDestinationCreateWithURL(
            (__bridge CFURLRef)outputURL,
            kJPEGType,
            1, NULL
        );
        if (!dest) {
            CGImageRelease(thumbnail);
            return 3;
        }

        NSDictionary* opts = @{
            (__bridge NSString*)kCGImageDestinationLossyCompressionQuality: @(quality)
        };
        CGImageDestinationAddImage(dest, thumbnail, (__bridge CFDictionaryRef)opts);
        bool ok = CGImageDestinationFinalize(dest);

        CFRelease(dest);
        CGImageRelease(thumbnail);
        return ok ? 0 : 4;
    }
}

// ---------- extractVideoFrame ----------

extern "C" int extractVideoFrame(const char* videoPath, const char* outPath, int maxDim) {
    @autoreleasepool {
        NSString* video = [NSString stringWithUTF8String:videoPath];
        NSString* output = [NSString stringWithUTF8String:outPath];

        NSURL* videoURL = [NSURL fileURLWithPath:video];
        NSURL* outputURL = [NSURL fileURLWithPath:output];

        AVAsset* asset = [AVAsset assetWithURL:videoURL];
        AVAssetImageGenerator* generator = [[AVAssetImageGenerator alloc] initWithAsset:asset];
        generator.appliesPreferredTrackTransform = YES;
        generator.maximumSize = CGSizeMake(maxDim, maxDim);

        NSError* error = nil;
        CGImageRef frame = [generator copyCGImageAtTime:kCMTimeZero actualTime:NULL error:&error];
        if (!frame) return 1;

        CGImageDestinationRef dest = CGImageDestinationCreateWithURL(
            (__bridge CFURLRef)outputURL,
            kJPEGType,
            1, NULL
        );
        if (!dest) {
            CGImageRelease(frame);
            return 2;
        }

        NSDictionary* opts = @{
            (__bridge NSString*)kCGImageDestinationLossyCompressionQuality: @(0.9)
        };
        CGImageDestinationAddImage(dest, frame, (__bridge CFDictionaryRef)opts);
        bool ok = CGImageDestinationFinalize(dest);

        CFRelease(dest);
        CGImageRelease(frame);
        return ok ? 0 : 3;
    }
}

// ---------- runAppleScript ----------

extern "C" int runAppleScript(const char* script, char* errBuf, int errBufLen) {
    @autoreleasepool {
        NSString* source = [NSString stringWithUTF8String:script];
        NSAppleScript* appleScript = [[NSAppleScript alloc] initWithSource:source];
        NSDictionary* errorInfo = nil;
        [appleScript executeAndReturnError:&errorInfo];
        if (errorInfo != nil) {
            NSString* msg = errorInfo[NSAppleScriptErrorMessage]
                            ?: [errorInfo description];
            const char* utf8 = [msg UTF8String];
            strlcpy(errBuf, utf8, errBufLen);
            return 1;
        }
        return 0;
    }
}
