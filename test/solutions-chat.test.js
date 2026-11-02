"use strict";

const chat = require("../plugins/solutions-chat/renderer");

describe("solutions-chat parseQueries", () => {
  test("reads a JSON array, even inside a code fence", () => {
    expect(chat.parseQueries('```json\n["reset mfa", "Authenticator new phone"]\n```')).toEqual(["reset mfa", "Authenticator new phone"]);
  });

  test("falls back to list lines, dedupes and caps at three", () => {
    expect(chat.parseQueries("1. vpn\n- VPN\n* printer offline\n• mfa\n- outlook")).toEqual(["vpn", "printer offline", "mfa"]);
  });

  test("returns nothing for an empty reply", () => {
    expect(chat.parseQueries("")).toEqual([]);
    expect(chat.parseQueries(null)).toEqual([]);
  });
});

describe("solutions-chat fallbackQuery", () => {
  test("keeps the meaningful words", () => {
    expect(chat.fallbackQuery("How do I reset MFA for a user on Outlook?")).toBe("reset mfa outlook");
  });
});

describe("solutions-chat mergeResults", () => {
  test("interleaves lists and drops duplicates", () => {
    const merged = chat.mergeResults([
      [{ id: 1 }, { id: 2 }, { id: 3 }],
      [{ id: 2 }, { id: 4 }],
    ], 3);
    expect(merged.map((a) => a.id)).toEqual([1, 2, 4]);
  });

  test("copes with missing lists", () => {
    expect(chat.mergeResults([undefined, [{ id: 5 }]], 5)).toEqual([{ id: 5 }]);
  });
});

describe("solutions-chat prompts", () => {
  test("the answer prompt numbers articles, marks drafts and fences data", () => {
    const prompt = chat.buildAnswerPrompt(
      "how to reset mfa",
      [{ role: "user", text: "hi" }, { role: "assistant", text: "hello" }],
      "Ticket #7: MFA broken",
      [{ title: 'MFA "reset"', status: "draft", text: "Step one", truncated: true }, { title: "Other", text: "Two" }],
    );
    expect(prompt).toContain('<article number="1" title="MFA &quot;reset&quot;" status="draft">');
    expect(prompt).toContain("[article continues]");
    expect(prompt).toContain('<article number="2" title="Other" status="published">');
    expect(prompt).toContain("<ticket>\nTicket #7: MFA broken\n</ticket>");
    expect(prompt).toContain("Agent: hi");
    expect(prompt).toMatch(/only the\s+Freshservice Solutions articles/);
  });

  test("the query prompt asks for a JSON array and leaves out an empty ticket", () => {
    const prompt = chat.buildQueryPrompt("printer offline", [], "");
    expect(prompt).toContain("JSON array");
    expect(prompt).not.toContain("<ticket>");
    expect(prompt.endsWith("printer offline")).toBe(true);
  });

  test("history keeps only the latest messages", () => {
    const history = Array.from({ length: 10 }, (_, i) => ({ role: i % 2 ? "assistant" : "user", text: "m" + i }));
    const text = chat.formatHistory(history);
    expect(text).not.toContain("m3");
    expect(text).toContain("m4");
    expect(text).toContain("m9");
  });
});

describe("solutions-chat answerToHtml", () => {
  test("escapes HTML and links only known citations", () => {
    const html = chat.answerToHtml("Use <b>this</b> [1] and [3]\n1. **First**\n2. Second", 2);
    expect(html).toContain("&lt;b&gt;this&lt;/b&gt;");
    expect(html).toContain('<a href="#" class="sc-cite" data-n="1">[1]</a>');
    expect(html).toContain(" and [3]");
    expect(html).toContain("<ol><li><strong>First</strong></li><li>Second</li></ol>");
  });
});
