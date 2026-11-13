// herdr-optwatch [0|1]: waits until the Option key (alone: no ⌘, ⌃ or ⇧) is held or let go,
// unlike the state it's given, then prints the new state ("1" held, "0" not) and exits. Held
// counts once it has stayed down 150 ms, so a quick ⌥+key doesn't flash. After 30 seconds by
// the clock it prints the state anyway, so mods/my-projects, which runs it while Herdr is the
// app in front, stops it soon after Herdr goes to the back. (The deadline is by the clock:
// counting 30 ms naps ran far over when macOS stretched them.)
// my-projects shows each project's ⌥1–⌥9 number while ⌥ is held. A mod hears modifier keys only
// with keyboard focus, which a terminal has, and Herdr passes its window's own modifier changes
// to no mod; reading them here needs no permission.
//
// herdr-optwatch up: waits until the left mouse button is up, then prints "up" ("timeout" after
// 55 seconds, inside my-tabs' 65-second exec limit). mods/my-tabs runs it when a pane's name is dragged down out of the tab bar: a mod
// hears the mouse only while it's over it, so this is how the bar learns the drag ended, and
// splits the pane out then rather than as the pointer leaves. Also no permission needed.
//
// Built by install.sh into ~/.local/bin/herdr-optwatch.
#include <ApplicationServices/ApplicationServices.h>
#include <stdio.h>
#include <string.h>
#include <time.h>
#include <unistd.h>

// Seconds on a clock that keeps going while the Mac sleeps, for deadlines that hold however
// long each nap really takes.
static double now(void) {
  struct timespec t;
  clock_gettime(CLOCK_MONOTONIC, &t);
  return t.tv_sec + t.tv_nsec / 1e9;
}

static int held(void) {
  CGEventFlags f = CGEventSourceFlagsState(kCGEventSourceStateCombinedSessionState);
  return (f & kCGEventFlagMaskAlternate) && !(f & (kCGEventFlagMaskCommand | kCGEventFlagMaskControl | kCGEventFlagMaskShift));
}

static int pressed(void) {
  return CGEventSourceButtonState(kCGEventSourceStateCombinedSessionState, kCGMouseButtonLeft);
}

int main(int argc, char **argv) {
  if (argc > 1 && strcmp(argv[1], "up") == 0) {
    for (double end = now() + 55; now() < end;) {
      if (getppid() == 1) return 0; // whoever asked is gone
      if (!pressed()) { printf("up\n"); return 0; }
      usleep(10000);
    }
    printf("timeout\n");
    return 0;
  }
  int known = argc > 1 && argv[1][0] == '1';
  for (double end = now() + 30; now() < end;) {
    if (getppid() == 1) return 0; // whoever asked is gone
    int state = held();
    if (state != known) {
      int stays = 1;
      for (int j = 0; state && stays && j < 5; j++) { usleep(30000); stays = held(); }
      if (stays) { printf("%d\n", state); return 0; }
    }
    usleep(30000);
  }
  printf("%d\n", held());
  return 0;
}
