/**
 * Video format library — structural blueprints that give each video a distinct
 * narrative shape instead of the same flat "explainer" every time.
 *
 * Formats are niche-agnostic beat sheets. A project limits which are allowed via
 * config.video.formats (default: all); the script stage picks the best fit for
 * the topic while avoiding whatever recent videos used, so a channel's uploads
 * don't all feel like the same video with different nouns.
 */

export interface VideoFormat {
  key: string;
  label: string;
  whenToUse: string;
  beats: string;
}

export const FORMATS: Record<string, VideoFormat> = {
  story: {
    key: "story",
    label: "Story",
    whenToUse: "the topic has a protagonist (a person, animal, object, place, or event) whose experience can carry the video",
    beats: [
      "1. COLD OPEN: drop the viewer into the single most dramatic moment of the story, mid-action, then rewind ('to understand how we got here...').",
      "2. SETUP: introduce the protagonist and what normal looked like — make the viewer care in 2 sentences.",
      "3. RISING PROBLEM: something changes; stakes escalate scene by scene (each scene raises the question 'so what happened next?').",
      "4. THE TURN: the surprising pivot — the fact almost nobody knows.",
      "5. RESOLUTION + MEANING: how it ended and why it still matters, connected back to the cold open.",
    ].join("\n"),
  },
  mystery: {
    key: "mystery",
    label: "Mystery / Investigation",
    whenToUse: "the topic has a genuine puzzle — something unexplained, counterintuitive, or long misunderstood",
    beats: [
      "1. THE ANOMALY: present the strange fact plainly and concretely — make the viewer NEED the explanation.",
      "2. FALSE LEAD: the obvious explanation, and the specific evidence that kills it.",
      "3. CLUES: walk through 2-3 real clues, each narrowing the answer, each scene ending on a small reveal.",
      "4. THE REVEAL: the actual explanation, delivered as a payoff that reframes everything shown so far.",
      "5. THE KICKER: one remaining open question or consequence that lingers after the video ends.",
    ].join("\n"),
  },
  countdown: {
    key: "countdown",
    label: "Countdown",
    whenToUse: "the topic naturally ranks — several examples where each can top the previous",
    beats: [
      "1. STAKES: one line establishing what's being ranked and why #1 is hard to believe (tease it concretely without spoiling).",
      "2. THE CLIMB: each entry gets its own scene(s) with one unforgettable specific detail — never a generic description. Escalate genuinely: every entry must out-do the previous or explicitly subvert expectations.",
      "3. BEFORE #1: a deliberate pause — recap the tease, let tension build for one beat.",
      "4. #1: the payoff must actually deliver — the single best fact of the whole video lives here.",
      "5. OUTRO: which entry would the viewer pick? Invite disagreement.",
    ].join("\n"),
  },
  versus: {
    key: "versus",
    label: "Versus",
    whenToUse: "two subjects invite a genuine head-to-head comparison with a non-obvious winner",
    beats: [
      "1. THE MATCHUP: introduce both contenders with their single most impressive credential each.",
      "2. ROUNDS: 3-4 rounds, each a specific measurable dimension; declare a round winner each time with the deciding fact. Alternate winners early so the outcome stays uncertain.",
      "3. THE UPSET FACTOR: one fact that flips what the viewer assumed.",
      "4. VERDICT: an honest overall call with the reasoning — plus the scenario where the loser wins.",
    ].join("\n"),
  },
  journey: {
    key: "journey",
    label: "Journey",
    whenToUse: "the topic spans a scale — size, depth, time, distance, temperature — that can be traveled through",
    beats: [
      "1. POINT OF DEPARTURE: start somewhere familiar the viewer can picture instantly.",
      "2. THE DESCENT/ASCENT: each scene is the next stop along the scale; name where we are concretely at every stop, and make each stop stranger than the last.",
      "3. LANDMARK COMPARISONS: anchor every stop to something the viewer knows (a building, a city, their own body).",
      "4. THE FINAL STOP: the extreme end — the destination the whole journey promised.",
      "5. LOOKING BACK: one line that measures how far we came.",
    ].join("\n"),
  },
  mythbusting: {
    key: "mythbusting",
    label: "Myth-busting",
    whenToUse: "the topic carries widely believed 'facts' that are actually wrong",
    beats: [
      "1. THE TRAP: open with the myth stated the way everyone believes it — then 'except that's not what happens at all.'",
      "2. BUSTS: each myth gets its own arc — why people believe it (be fair to the myth), the evidence against it, and the true version, which must be MORE interesting than the myth.",
      "3. THE ONE THAT'S TRUE: include one belief that sounds fake but is real — keeps the viewer off-balance.",
      "4. CLOSE: the biggest misconception saved for last, and what it says about why we get this topic wrong.",
    ].join("\n"),
  },
  "how-it-works": {
    key: "how-it-works",
    label: "How it works",
    whenToUse: "the topic is a process or system whose inner workings are surprising",
    beats: [
      "1. THE IMPOSSIBLE RESULT: open with the astonishing end result, stated concretely — then 'so how is that possible?'",
      "2. THE CHAIN: follow the process step by step as a physical journey (follow the water drop, the signal, the coin), each step answering one 'but how?' and raising the next.",
      "3. THE BOTTLENECK: the hardest step — the part that should make the whole thing fail, and the clever trick that solves it.",
      "4. PAYOFF: return to the opening result, which now makes complete sense — say what the viewer can now 'see' that they couldn't before.",
    ].join("\n"),
  },
  "what-if": {
    key: "what-if",
    label: "What if",
    whenToUse: "a hypothetical premise lets real facts shine — 'what if X stopped/doubled/disappeared'",
    beats: [
      "1. THE PREMISE: state the hypothetical in one vivid sentence and immediately start the clock ('the first second, ...').",
      "2. ESCALATION: consequences unfold in time order (seconds → hours → years), every step grounded in real verifiable science or history — the fun is that none of it is made up.",
      "3. THE SURPRISE SURVIVOR: one thing that would be unexpectedly fine, or unexpectedly doomed.",
      "4. SNAP BACK: return to reality — what the hypothetical reveals about how the real system actually works.",
    ].join("\n"),
  },
};

export const ALL_FORMAT_KEYS = Object.keys(FORMATS);

export function formatMenu(allowed: string[]): string {
  return allowed
    .filter((k) => FORMATS[k])
    .map((k) => `### ${FORMATS[k].label} (key: "${k}")\nBest when: ${FORMATS[k].whenToUse}.\nBeats:\n${FORMATS[k].beats}`)
    .join("\n\n");
}
