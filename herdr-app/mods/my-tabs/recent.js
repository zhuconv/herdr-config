// my-tabs: ⌃Tab switches agents in the order you last visited them, as ⌘Tab does for apps.
// Recent keeps that order; my-tabs feeds it the focused agent a few times a second.

export class Recent {
  constructor(saved) {
    this.order = Array.isArray(saved) ? saved : []; // addresses, most recent first
  }

  // True when the order changed, i.e. worth saving.
  visit(address) {
    if (!address || this.order[0] === address) return false;
    this.order = [address, ...this.order.filter((a) => a !== address)].slice(0, 50);
    return true;
  }

  // What ⌃Tab offers: the current agent first, then the others by when you last
  // visited them, then ones never visited, in the order agents() lists them.
  list(agents, current) {
    const live = agents.map((a) => a.address);
    const has = new Set(live);
    const visited = this.order.filter((a) => has.has(a) && a !== current);
    const rest = live.filter((a) => a !== current && !visited.includes(a));
    return [...(current && has.has(current) ? [current] : []), ...visited, ...rest];
  }
}
