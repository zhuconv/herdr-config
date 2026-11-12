// my-tabs: ⌃Tab switches panes in the order you last focused them, as ⌘Tab does for apps.
// Any terminal counts (an agent, a background session, a shell you've been in), so the two
// panes of a split take turns too. Recent keeps that order; my-tabs feeds it the focused
// terminal a few times a second.

export class Recent {
  constructor(saved) {
    this.order = Array.isArray(saved) ? saved : []; // terminal addresses, most recent first
  }

  // True when the order changed, i.e. worth saving.
  visit(address) {
    if (!address || this.order[0] === address) return false;
    this.order = [address, ...this.order.filter((a) => a !== address)].slice(0, 50);
    return true;
  }

  // What ⌃Tab offers: the current terminal first, then the others by when you last focused
  // them, then agents never focused, in Herdr's order. live: every terminal shown in a pane;
  // agents: the agents among them (background sessions too).
  list(live, agents, current) {
    const has = new Set(live);
    const visited = this.order.filter((a) => has.has(a) && a !== current);
    const rest = agents.filter((a) => a !== current && has.has(a) && !visited.includes(a));
    return [...(current && has.has(current) ? [current] : []), ...visited, ...rest];
  }
}
