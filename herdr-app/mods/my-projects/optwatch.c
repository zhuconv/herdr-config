// herdr-optwatch [0|1]: waits until the Option key (alone: no ⌘, ⌃ or ⇧) is held or let go,
// unlike the state it's given, then prints the new state ("1" held, "0" not) and exits. Held
// counts once it has stayed down 150 ms, so a quick ⌥+key doesn't flash. After 9 minutes it
// prints the state anyway: mods/my-projects runs it with exec, which allows 10 at most.
// my-projects shows each project's ⌥1–⌥9 number while ⌥ is held. A mod hears modifier keys only
// with keyboard focus, which a terminal has; reading them here needs no permission.
// Built by install.sh into ~/.local/bin/herdr-optwatch.
#include <ApplicationServices/ApplicationServices.h>
#include <stdio.h>
#include <unistd.h>

static int held(void) {
  CGEventFlags f = CGEventSourceFlagsState(kCGEventSourceStateCombinedSessionState);
  return (f & kCGEventFlagMaskAlternate) && !(f & (kCGEventFlagMaskCommand | kCGEventFlagMaskControl | kCGEventFlagMaskShift));
}

int main(int argc, char **argv) {
  int known = argc > 1 && argv[1][0] == '1';
  for (int i = 0; i < 9 * 60 * 1000 / 30; i++) {
    if (getppid() == 1) return 0; // whoever asked is gone
    int now = held();
    if (now != known) {
      int stays = 1;
      for (int j = 0; now && stays && j < 5; j++) { usleep(30000); stays = held(); }
      if (stays) { printf("%d\n", now); return 0; }
    }
    usleep(30000);
  }
  printf("%d\n", held());
  return 0;
}
