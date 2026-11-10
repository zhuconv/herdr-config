// postkey <pid> <keycode> [cmd|shift|alt|ctrl]...: presses a key in one app only.
// The event goes straight to that process, so global hotkeys (Raycast's) don't see it.
// ~/Documents/Raycast/bear/herdr-waiting.sh uses it to hand ⌘G back to VS Code.
// Posting needs Accessibility for the app that runs it (Raycast); without it, exit 3.
// Build (the default SDK, 27.0, is newer than this toolchain; 26.5 matches):
//   clang -O2 -isysroot /Library/Developer/CommandLineTools/SDKs/MacOSX26.5.sdk -framework ApplicationServices -o ~/.local/bin/postkey ~/.local/share/postkey/postkey.c
#include <ApplicationServices/ApplicationServices.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

static int fail(int code, const char *message) {
  fprintf(stderr, "postkey: %s\n", message);
  return code;
}

int main(int argc, char **argv) {
  const char *usage = "usage: postkey <pid> <keycode> [cmd|shift|alt|ctrl]...";
  if (argc < 3) return fail(2, usage);
  char *end;
  long pid = strtol(argv[1], &end, 10);
  if (*end || pid <= 0) return fail(2, usage);
  long key = strtol(argv[2], &end, 10);
  if (*end || key < 0 || key > 127) return fail(2, usage);
  CGEventFlags flags = 0;
  for (int i = 3; i < argc; i++) {
    if (!strcmp(argv[i], "cmd")) flags |= kCGEventFlagMaskCommand;
    else if (!strcmp(argv[i], "shift")) flags |= kCGEventFlagMaskShift;
    else if (!strcmp(argv[i], "alt")) flags |= kCGEventFlagMaskAlternate;
    else if (!strcmp(argv[i], "ctrl")) flags |= kCGEventFlagMaskControl;
    else return fail(2, "unknown modifier");
  }
  if (!AXIsProcessTrusted()) return fail(3, "no Accessibility permission");
  CGEventSourceRef source = CGEventSourceCreate(kCGEventSourceStateHIDSystemState);
  for (int down = 1; down >= 0; down--) {
    CGEventRef event = CGEventCreateKeyboardEvent(source, (CGKeyCode)key, down);
    if (!event) return fail(1, "cannot make the event");
    CGEventSetFlags(event, flags);
    CGEventPostToPid((pid_t)pid, event);
    CFRelease(event);
  }
  if (source) CFRelease(source);
  return 0;
}
