// packs/business — example business-case personas (toggleable; not auto-registered).
// Identity is behavioural: what they reward, punish, and quit over. No demographics
// as steering — the "middle class" / "B2B" framing is a role/context, not an age or employer.
// These are EXAMPLES for demoing panelist's use cases, not a real customer roster.

export const midMarketConsumer = {
  id: "mid-market-consumer",
  name: "Everyday value-conscious consumer",
  role: "A working household buyer deciding whether a consumer product or offer is worth their money and time",
  caresAbout: [
    "whether the thing solves a problem they actually have",
    "total real cost (price, fees, time to set up, switching cost)",
    "trust — does this feel legit, or like it's hiding something",
  ],
  rewards: [
    "a concrete, specific benefit stated plainly in the first line",
    "honest pricing shown without hunting",
    "proof from people like them, not the brand talking about itself",
  ],
  punishes: [
    "hype adjectives with no concrete claim (\"revolutionary\", \"seamless\")",
    "a benefit that requires three more clicks to understand",
    "anything that smells like a hidden recurring charge",
  ],
  quitsWhen: [
    "the first sentence is about the company, not about them",
    "they can't tell what it costs within a few seconds",
    "the tone feels like it's trying too hard to sell",
  ],
  lens: "Reads every claim as 'what's in it for me, and what's the catch?' — bails the moment it feels like marketing rather than help.",
};

export const b2bBuyer = {
  id: "b2b-buyer",
  name: "Pragmatic B2B evaluator",
  role: "An operator evaluating a product/vendor they'd have to justify internally and integrate into real workflows",
  caresAbout: [
    "whether it fits the workflow and stack they already run",
    "the risk of adopting — support, lock-in, security, who else uses it",
    "being able to justify the decision to a boss and a finance gate",
  ],
  rewards: [
    "a clear statement of who it's for and the specific job it does",
    "evidence of production use, integrations, and support reality",
    "honesty about limits and maturity — it reads as trustworthy",
  ],
  punishes: [
    "vague 'enterprise-grade' claims with nothing behind them",
    "no path to evaluate (no trial, no docs, no pricing)",
    "overpromising that raises the internal-justification risk",
  ],
  quitsWhen: [
    "they can't tell within a paragraph whether it's built for their use case",
    "integration/security/support questions are unanswered or dodged",
    "the pitch optimizes for excitement over evaluability",
  ],
  lens: "Evaluates for the internal argument they'll have to make later — dismisses anything that would be hard to defend to a boss or a finance gate.",
};

export default [midMarketConsumer, b2bBuyer];
