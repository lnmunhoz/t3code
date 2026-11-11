export type ReplyQuestionVerdict = "question" | "none" | "unsure";

const TAIL_CHARS = 1_200;
const FENCED_CODE = /```[\s\S]*?(?:```|$)/g;
const TRAILING_DECORATION = /[\s*_`'")\]”’]+$/;
const LIST_LINE = /^\s*(?:[-*+]|\d+[.)])\s+/;
// Phrases that often hand the turn back to the user without a question mark.
const ASK_PHRASES =
  /\b(?:let me know|should i|shall i|would you like|do you want|want me to|which (?:one|option|approach|do you)|your call|up to you|prefer|confirm|tell me|waiting (?:on|for) you)\b/i;

// Closers that offer more help without waiting on an answer.
const POLITE_CLOSER =
  /\b(?:let me know|feel free to (?:ask|reach out)|just (?:ask|say the word))\b[^.?!]*\b(?:anything else|other questions?|more help|further (?:help|changes))\b[^?]*$/i;

const paragraphsOf = (text: string): ReadonlyArray<string> =>
  text
    .replace(FENCED_CODE, "")
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.trim())
    .filter((paragraph) => paragraph.length > 0);

const endsWithQuestion = (paragraph: string): boolean =>
  paragraph.replace(TRAILING_DECORATION, "").endsWith("?");

const isList = (paragraph: string): boolean =>
  paragraph.split("\n").every((line) => LIST_LINE.test(line) || /^\s{2,}\S/.test(line));

/** Decides from text alone when it can; "unsure" replies go to a model. */
export function classifyReplyQuestion(text: string): ReplyQuestionVerdict {
  const paragraphs = paragraphsOf(text);
  const last = paragraphs.at(-1);
  if (last === undefined) return "none";
  // "Which do you prefer?" followed by the options as a list.
  const lead = isList(last) ? paragraphs.at(-2) : undefined;
  if (endsWithQuestion(last) || (lead !== undefined && endsWithQuestion(lead))) {
    return "question";
  }
  const closing = lead === undefined ? last : `${lead}\n${last}`;
  const asks = closing.replace(POLITE_CLOSER, "");
  return asks.includes("?") || ASK_PHRASES.test(asks) ? "unsure" : "none";
}

export function replyQuestionTail(text: string): string {
  const stripped = paragraphsOf(text).join("\n\n");
  return stripped.length <= TAIL_CHARS ? stripped : stripped.slice(-TAIL_CHARS);
}

export function buildReplyQuestionPrompt(tail: string): string {
  return [
    "Classify the end of a coding agent's reply to its user.",
    "Does the agent need the user to reply before it can continue?",
    '- "yes": it asks the user a question, or asks them to choose, confirm, decide or provide something.',
    '- "no": it reports work. A polite optional offer such as "let me know if you need anything else" is still "no".',
    "",
    "Examples:",
    '- "Tests pass. Let me know if anything else comes up." -> no',
    '- "I can patch it or rewrite it. Let me know which you prefer." -> yes',
    '- "Why did it fail? The cache key was stale, so I fixed it." -> no',
    '- "Please confirm the old data can be deleted before I run the migration." -> yes',
    "",
    "<reply_end>",
    tail,
    "</reply_end>",
    "",
    'The output field is named "transcription" for historical reasons. In it, write one short sentence saying what the last sentences ask of the user, then end with "ANSWER: yes" or "ANSWER: no".',
  ].join("\n");
}

export const parseReplyQuestionAnswer = (answer: string): boolean =>
  /\bANSWER:\s*yes\b/i.test(answer) || /^\W*yes\W*$/i.test(answer.trim());
