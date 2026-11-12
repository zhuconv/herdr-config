// support.js: a small stand-in for the design canvas's runtime, so the canvas file (index.html,
// the same file as the canvas's Main.dc.html) plays in any browser. It reads the page's <x-dc>
// template and its logic class (<script type="text/x-dc" data-dc-script>) and renders them with
// Preact (preact.umd.js, MIT, see LICENSE-preact.txt).
//
// What it supports is what that file uses: {{ path }} holes (a dotted lookup, or a literal like
// {{ true }}) in text and attributes; an attribute that is one whole hole passes the value itself
// (a function, a boolean), others are strings; <sc-if value>, <sc-for list as> (with $index);
// on* attributes as event handlers; <helmet> moved into <head>; autofocus focuses on mount. The
// logic class extends DCLogic, which is a Preact component whose render is the template filled
// with renderVals().
(function () {
  const hide = document.createElement("style");
  hide.textContent = "x-dc{display:none}";
  document.head.appendChild(hide);

  let preactReady = false, domReady = document.readyState !== "loading";
  const lib = document.createElement("script");
  lib.src = "./preact.umd.js";
  lib.onload = () => { preactReady = true; start(); };
  document.head.appendChild(lib);
  if (!domReady) document.addEventListener("DOMContentLoaded", () => { domReady = true; start(); });

  // Attributes whose "true" / "false" mean a boolean, not a string.
  const BOOL = new Set(["spellcheck", "draggable", "contenteditable"]);
  const WHOLE = /^\{\{([^{}]*)\}\}$/;

  // The template as plain data: { text } or { tag, attrs, kids }. Whitespace between tags that
  // holds a line break is layout, not content, and is dropped.
  function compile(node) {
    if (node.nodeType === 3) {
      const t = node.nodeValue;
      return !t.trim() && t.includes("\n") ? null : { text: t };
    }
    if (node.nodeType !== 1) return null;
    return {
      tag: node.localName,
      attrs: [...node.attributes].map((a) => [a.name, a.value]),
      kids: [...node.childNodes].map(compile).filter(Boolean),
    };
  }

  function look(expr, scope) {
    const e = expr.trim();
    if (e === "true") return true;
    if (e === "false") return false;
    if (e === "null") return null;
    if (e === "undefined" || e === "") return undefined;
    if (/^-?\d+(\.\d+)?$/.test(e)) return Number(e);
    if (/^'[^']*'$|^"[^"]*"$/.test(e)) return e.slice(1, -1);
    let v = scope;
    for (const k of e.split(".")) {
      if (v == null) return undefined;
      v = v[k];
    }
    return v;
  }

  function fill(raw, scope) {
    const m = WHOLE.exec(raw.trim());
    if (m) return look(m[1], scope);
    if (!raw.includes("{{")) return raw;
    return raw.replace(/\{\{([^{}]*)\}\}/g, (_, e) => {
      const v = look(e, scope);
      return v == null ? "" : String(v);
    });
  }

  const attr = (n, name) => (n.attrs.find((a) => a[0] === name) || [])[1] || "";

  function focusOnce(el) {
    if (el && !el.__dcFocused) {
      el.__dcFocused = true;
      setTimeout(() => el.focus(), 0);
    }
  }

  function start() {
    if (!preactReady || !domReady || start.done) return;
    start.done = true;
    const { h, render, Component, Fragment } = window.preact;
    const xdc = document.querySelector("x-dc");
    const script = document.querySelector("script[data-dc-script]");
    if (!xdc || !script) return;

    const helmet = [...xdc.children].find((c) => c.localName === "helmet");
    if (helmet) [...helmet.children].forEach((c) => document.head.appendChild(c.cloneNode(true)));
    const tree = [...xdc.childNodes].filter((c) => c !== helmet).map(compile).filter(Boolean);
    xdc.remove();

    function build(n, scope) {
      if (n.text !== undefined) return fill(n.text, scope);
      if (n.tag === "sc-if") return fill(attr(n, "value"), scope) ? n.kids.map((k) => build(k, scope)) : null;
      if (n.tag === "sc-for") {
        const list = fill(attr(n, "list"), scope) || [], as = attr(n, "as") || "item";
        return list.map((item, i) => {
          const s = Object.create(scope);
          s[as] = item;
          s.$index = i;
          return n.kids.map((k) => build(k, s));
        });
      }
      const props = {};
      for (const [name, raw] of n.attrs) {
        if (name.startsWith("hint-")) continue;
        const v = fill(raw, scope);
        if (name === "autofocus") { if (v === true || v === "" || v === "true") props.ref = focusOnce; continue; }
        if (name.startsWith("on")) { if (typeof v === "function") props[name] = v; continue; }
        props[name] = BOOL.has(name) && (v === "true" || v === "false") ? v === "true" : v;
      }
      return h(n.tag, props, n.kids.map((k) => build(k, scope)));
    }

    class DCLogic extends Component {
      render() {
        const vals = this.renderVals();
        return h(Fragment, null, tree.map((n) => build(n, vals)));
      }
    }
    const Logic = new Function("DCLogic", `${script.textContent}\n;return Component;`)(DCLogic);
    const root = document.createElement("div");
    root.id = "dc-root";
    document.body.appendChild(root);
    render(h(Logic, {}), root);
  }
})();
