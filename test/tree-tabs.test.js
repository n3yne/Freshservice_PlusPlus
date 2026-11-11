"use strict";

const { createTree, restore, cleanName, MAX_DEPTH } = require("../plugins/tree-tabs/renderer");
const treeMain = require("../plugins/tree-tabs/main");

// "a(b,c(d)),e" style outline of the tree, using tab ids and group names.
function outline(tree) {
  function label(n) { return n.kind === "tab" ? n.tabId : "[" + n.name + "]"; }
  function walk(list) {
    return list.map((id) => {
      const n = tree.get(id);
      return label(n) + (n.children.length ? "(" + walk(n.children) + ")" : "");
    }).join(",");
  }
  return walk(tree.roots);
}

describe("tree-tabs model", () => {
  test("adds tabs at the top level or under a parent", () => {
    const t = createTree();
    const a = t.addTab("a");
    t.addTab("b", { parentId: a.id });
    t.addTab("c");
    expect(outline(t)).toBe("a(b),c");
    expect(t.addTab("a")).toBe(a); // same tab twice → same node
  });

  test("closing a tab moves its children into its place", () => {
    const t = createTree();
    const a = t.addTab("a");
    t.addTab("b", { parentId: a.id });
    t.addTab("c", { parentId: a.id });
    t.addTab("d");
    t.removeTab("a");
    expect(outline(t)).toBe("b,c,d");
    expect(t.nodeForTab("a")).toBeNull();
    expect(t.get(t.nodeForTab("b").id).parentId).toBeNull();
  });

  test("moves before, after and inside, and refuses to move into itself", () => {
    const t = createTree();
    const a = t.addTab("a");
    const b = t.addTab("b");
    const c = t.addTab("c");
    expect(t.move(c.id, a.id, "before")).toBe(true);
    expect(outline(t)).toBe("c,a,b");
    expect(t.move(c.id, b.id, "after")).toBe(true);
    expect(outline(t)).toBe("a,b,c");
    expect(t.move(b.id, a.id, "inside")).toBe(true);
    expect(t.move(c.id, b.id, "inside")).toBe(true);
    expect(outline(t)).toBe("a(b(c))");
    expect(t.move(a.id, c.id, "inside")).toBe(false); // into its own grandchild
    expect(t.move(a.id, a.id, "after")).toBe(false);
    expect(outline(t)).toBe("a(b(c))");
    expect(t.move(c.id, null)).toBe(true);
    expect(outline(t)).toBe("a(b),c");
  });

  test("groups wrap tabs, ungroup keeps the tabs, removeSubtree drops everything", () => {
    const t = createTree();
    t.addTab("a");
    const b = t.addTab("b");
    t.addTab("c");
    const g = t.wrapInGroup(b.id, "Client X");
    expect(outline(t)).toBe("a,[Client X](b),c");
    const sub = t.addGroup("Sub", { parentId: g.id });
    t.addTab("d", { parentId: sub.id });
    expect(outline(t)).toBe("a,[Client X](b,[Sub](d)),c");
    expect(t.descendants(g.id).map((id) => t.get(id).tabId || t.get(id).name)).toEqual(["b", "Sub", "d"]);
    t.remove(g.id);
    expect(outline(t)).toBe("a,b,[Sub](d),c");
    t.removeSubtree(t.roots[2]);
    expect(outline(t)).toBe("a,b,c");
    expect(t.hasTab("d")).toBe(false);
  });

  test("outdent moves a node just after its parent", () => {
    const t = createTree();
    const a = t.addTab("a");
    const b = t.addTab("b", { parentId: a.id });
    t.addTab("c");
    expect(t.outdent(b.id)).toBe(true);
    expect(outline(t)).toBe("a,b,c");
    expect(t.outdent(b.id)).toBe(false);
  });

  test("flatten skips children of collapsed nodes when asked", () => {
    const t = createTree();
    const g = t.addGroup("G");
    t.addTab("a", { parentId: g.id });
    t.addTab("b");
    g.collapsed = true;
    expect(t.flatten(true).map((r) => r.depth + ":" + (r.node.tabId || r.node.name))).toEqual(["0:G", "0:b"]);
    expect(t.flatten(false).map((r) => r.depth + ":" + (r.node.tabId || r.node.name))).toEqual(["0:G", "1:a", "0:b"]);
  });

  test("nesting stops at the depth limit", () => {
    const t = createTree();
    let parent = null;
    for (let i = 0; i <= MAX_DEPTH + 3; i++) parent = t.addGroup("g" + i, { parentId: parent && parent.id });
    expect(t.depthOf(parent.id)).toBeLessThanOrEqual(MAX_DEPTH);
  });

  test("cleanName trims, collapses spaces and caps the length", () => {
    expect(cleanName("  Client   X \n")).toBe("Client X");
    expect(cleanName(5)).toBe("");
    expect(cleanName("x".repeat(300)).length).toBe(200);
  });
});

describe("tree-tabs save and restore", () => {
  const urls = { a: "https://a.example/", b: "https://b.example/", c: "https://c.example/", d: "https://d.example/" };

  function saved() {
    const t = createTree();
    const g = t.addGroup("Client X");
    const a = t.addTab("a", { parentId: g.id, name: "Master" });
    t.addTab("b", { parentId: a.id });
    t.addTab("c");
    g.collapsed = true;
    const order = ["c", "a", "b"]; // tab-bar order differs from tree order
    return t.serialize((tabId) => ({ url: urls[tabId], index: order.indexOf(tabId) }));
  }

  test("serializes depth first with addresses and tab-bar positions", () => {
    expect(saved()).toEqual({
      version: 1,
      entries: [
        { kind: "group", depth: 0, name: "Client X", collapsed: true },
        { kind: "tab", depth: 1, name: "Master", collapsed: false, url: urls.a, index: 1 },
        { kind: "tab", depth: 2, name: "", collapsed: false, url: urls.b, index: 2 },
        { kind: "tab", depth: 0, name: "", collapsed: false, url: urls.c, index: 0 },
      ],
    });
    expect(treeMain._isValidState(saved())).toBe(true);
  });

  test("matches restored tabs (new ids) by address", () => {
    const live = [{ tabId: "t1", url: urls.c }, { tabId: "t2", url: urls.a }, { tabId: "t3", url: urls.b }, { tabId: "t4", url: urls.d }];
    const t = restore(saved(), live);
    expect(outline(t)).toBe("[Client X](t2(t3)),t1,t4");
    expect(t.nodeForTab("t2").name).toBe("Master");
    expect(t.get(t.roots[0]).collapsed).toBe(true);
  });

  test("a saved tab that didn't come back hands its children up a level", () => {
    const live = [{ tabId: "t1", url: urls.c }, { tabId: "t3", url: urls.b }];
    expect(outline(restore(saved(), live))).toBe("[Client X](t3),t1");
  });

  test("tabs with the same address match in tab-bar order", () => {
    const t = createTree();
    const x = t.addTab("x");
    t.addTab("y", { parentId: x.id });
    const state = t.serialize((id) => ({ url: urls.a, index: id === "x" ? 0 : 1 }));
    expect(outline(restore(state, [{ tabId: "n1", url: urls.a }, { tabId: "n2", url: urls.a }]))).toBe("n1(n2)");
  });

  test("no saved tree puts every open tab at the top level", () => {
    expect(outline(restore(null, [{ tabId: "a", url: urls.a }, { tabId: "b", url: urls.b }]))).toBe("a,b");
  });

  test("tabs that can't be saved (no web address) are left out, children kept", () => {
    const t = createTree();
    const a = t.addTab("a");
    t.addTab("b", { parentId: a.id });
    const state = t.serialize((id) => (id === "a" ? null : { url: urls.b, index: 0 }));
    expect(state.entries).toEqual([{ kind: "tab", depth: 0, name: "", collapsed: false, url: urls.b, index: 0 }]);
  });
});

describe("tree-tabs main process", () => {
  test("validates saved trees", () => {
    const ok = { version: 1, entries: [{ kind: "group", depth: 0, name: "G", collapsed: false }, { kind: "tab", depth: 1, url: "https://x/", index: 0 }] };
    expect(treeMain._isValidState(ok)).toBe(true);
    expect(treeMain._isValidState({ version: 2, entries: [] })).toBe(false);
    expect(treeMain._isValidState({ version: 1, entries: [{ kind: "group", depth: 1 }] })).toBe(false); // skips a level
    expect(treeMain._isValidState({ version: 1, entries: [{ kind: "tab", depth: 0, url: "https://x/" }] })).toBe(false); // no index
    expect(treeMain._isValidState({ version: 1, entries: [{ kind: "folder", depth: 0 }] })).toBe(false);
    expect(treeMain._isValidState({ version: 1, entries: [{ kind: "group", depth: 0, name: "x".repeat(201) }] })).toBe(false);
    expect(treeMain._isValidState({ version: 1, entries: new Array(treeMain.MAX_ENTRIES + 1).fill({ kind: "group", depth: 0 }) })).toBe(false);
    expect(treeMain._isValidState(null)).toBe(false);
  });

  test("cleanState keeps only known fields", () => {
    const out = treeMain._cleanState({ version: 1, entries: [{ kind: "tab", depth: 0, url: "https://x/", index: 0, extra: 1 }] });
    expect(out).toEqual({ version: 1, entries: [{ kind: "tab", depth: 0, name: "", collapsed: false, url: "https://x/", index: 0 }] });
  });

  test("validateSettings", () => {
    expect(treeMain.validateSettings(treeMain.defaultSettings)).toBe(true);
    expect(treeMain.validateSettings({ treeTabsNestOpened: "yes" })).toBe(false);
  });
});
