// my-toast: what an agent's notification calls it. Pure (node test: .dev/test/names.test.mjs).
import { nameOf } from "./projects.js";

// The name of the agent a notification is about (Herdr's alert jumps to it with agent.focus), as
// the Agents list (mods/my-agents) gives it; null when it isn't about an agent that's there.
// live: { agents, panes, spaces } as Herdr gives them now.
export function agentName(p, live) {
  const addr = p?.action?.name === "agent.focus" ? p.action.args?.terminal : null;
  const a = addr ? live.agents.find((x) => x.address === addr) ?? live.panes.find((x) => x.terminal === addr) : null;
  if (!a) return null;
  const tab = live.spaces.flatMap((s) => s.tabs ?? []).find((t) => t.id === a.tab) ?? null;
  const many = live.agents.filter((x) => x.tab === a.tab).length > 1;
  return nameOf({ address: addr, title: a.title, program: a.program }, tab && many ? { ...tab, named: false } : tab) || null;
}

// Herdr's "<name> finished" / "<name> needs you", with that name; anything else as it came.
export function retitle(p, live) {
  const m = /^(.*) (finished|needs you)$/.exec(String(p?.title ?? ""));
  const who = m ? agentName(p, live) : null;
  return who ? { ...p, title: `${who} ${m[2]}` } : p;
}
