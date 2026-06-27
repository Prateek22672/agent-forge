// Static starter prompts shown on the empty state so it's obvious what each
// capability can do. Keyed by agent name; falls back to a generic set.
const BY_NAME = {
  "Web Search": [
    "What's the latest news on AI agents?",
    "Compare the top 3 note-taking apps",
    "Summarize the React 19 release",
  ],
  Email: [
    "Summarize my latest emails",
    "Anything important I should reply to?",
    "Any emails about placements or interviews?",
  ],
  Assistant: [
    "Remember that I'm preparing for placements",
    "What's 18% tip on ₹2,450?",
    "Plan my study schedule for this week",
  ],
};

const GENERIC = [
  "What can you help me with?",
  "Give me a quick example",
  "Summarize this for me",
];

export function startersFor(agentName) {
  return BY_NAME[agentName] || GENERIC;
}
