import { describe, expect, it } from "vite-plus/test";

import {
  classifyReplyQuestion,
  parseReplyQuestionAnswer,
  replyQuestionTail,
} from "./replyQuestion.ts";

describe("classifyReplyQuestion", () => {
  it.each([
    ["Done. Tests pass.\n\nWant me to open a PR?", "question"],
    ["Which approach do you prefer?**", "question"],
    ["I see two options. Which do you prefer?\n\n- Keep the cache\n- Drop it", "question"],
    ["Should I proceed (it touches the schema)?)", "question"],
    ["Fixed the bug and added a test.", "none"],
    ["Is it fast? Yes. The benchmark dropped from 2s to 40ms.", "unsure"],
    ["Ready when you are. Let me know which option you want.", "unsure"],
    ["Let me know if you need anything else.", "none"],
    ["Please confirm the schema change. Let me know if you need anything else.", "unsure"],
    ["Done.\n\n```ts\nconst ok = isReady?.();\n```", "none"],
    ["Should I keep going?\n\nAll tests pass and the build is green.", "none"],
    ["", "none"],
  ] as const)("%j is %s", (text, verdict) => {
    expect(classifyReplyQuestion(text)).toBe(verdict);
  });
});

describe("replyQuestionTail", () => {
  it("drops code and keeps the end of long replies", () => {
    const tail = replyQuestionTail(`${"x".repeat(2_000)}\n\n\`\`\`sh\nrm -rf /\n\`\`\`\n\nOk?`);
    expect(tail).not.toContain("rm -rf");
    expect(tail.endsWith("Ok?")).toBe(true);
    expect(tail.length).toBe(1_200);
  });
});

describe("parseReplyQuestionAnswer", () => {
  it.each([
    ["It asks the user to pick an option. ANSWER: yes", true],
    ["It only reports results. ANSWER: no", false],
    ["yes", true],
    ['"yes"', true],
    ["yesterday", false],
    ["", false],
  ] as const)("%j is %s", (answer, expected) => {
    expect(parseReplyQuestionAnswer(answer)).toBe(expected);
  });
});
