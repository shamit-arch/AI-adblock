/**
 * Lexical resources used by the detectors.
 *
 * Data only — no logic — so the lists can be tuned or localised without
 * touching the detectors. All patterns run against text whose curly quotes
 * and apostrophes were normalised to ASCII (see text-features.js).
 *
 * `weight` is the evidence a single match contributes inside its signal.
 */

/**
 * Chatbot boilerplate: text that is very rarely produced by people unless they
 * are pasting assistant output. Still never decisive on its own (it can be
 * quoted in articles about AI), see phrase-detector.js.
 */
export const CHATBOT_PATTERNS = [
  { re: /\bas an? (?:ai|artificial intelligence)(?: language)? (?:model|assistant|chatbot)\b/gi, weight: 1.2 },
  { re: /\bas an ai(?:,| developed by| trained by| created by)/gi, weight: 1.2 },
  { re: /\bas a (?:large )?language model\b/gi, weight: 1.2 },
  {
    re: /\bi(?:'m| am) (?:just |only )?an? (?:ai|artificial intelligence)(?: language)?(?: model| assistant| chatbot)?(?=[\s,.!;:]|$)(?! (?:researcher|engineer|expert|scientist|developer|enthusiast|skeptic|ethicist|student|professor|startup|company|policy|artist|critic))/gi,
    weight: 1.2,
  },
  { re: /\bmy (?:knowledge|training)(?: data)? ?(?:cutoff|cut-off)\b/gi, weight: 1.2 },
  { re: /\bas of my (?:last|latest) (?:knowledge )?(?:update|training)\b/gi, weight: 1.2 },
  {
    re: /\bi (?:don't|do not) have (?:personal (?:opinions|experiences|feelings|beliefs|preferences)|the ability to (?:browse|access)|access to real-time)/gi,
    weight: 1.2,
  },
  { re: /\bi (?:can't|cannot|am unable to) (?:browse the internet|access (?:the internet|real-time|external))/gi, weight: 1.2 },
  { re: /\bregenerate response\b/gi, weight: 1 },
  {
    re: /(?:^|\n)\s*(?:certainly|absolutely|of course|sure)[!,.]\s+(?:here(?:'s| is| are)|i(?:'d| would) be|let's|below)/gi,
    weight: 1,
  },
  { re: /\b(?:sure|certainly|absolutely)! here(?:'s| is| are)\b/gi, weight: 1 },
  { re: /\bhere(?:'s| is) (?:a |an |the )?(?:revised|rewritten|polished|refined|improved|updated|more concise) (?:version|draft)\b/gi, weight: 1 },
  { re: /\blet me know if you (?:need|have|would like|'d like|want) (?:any |more |further |additional |anything |me to )/gi, weight: 0.9 },
  { re: /\bi(?:'d| would) be (?:happy|glad|delighted) to (?:help|assist)\b/gi, weight: 0.6 },
  { re: /\b(?:great|excellent|good|fantastic) question[!.]/gi, weight: 0.6 },
  { re: /\bi apologi[sz]e for (?:the|any) (?:confusion|misunderstanding|oversight|error)\b/gi, weight: 0.8 },
  {
    re: /\bi(?:'m| am) sorry,? but i (?:can't|cannot|am unable to|won't be able to) (?:assist|help|provide|comply|fulfill|create|generate)/gi,
    weight: 1.1,
  },
  { re: /\bi (?:can't|cannot) assist with (?:that|this)\b/gi, weight: 1 },
  { re: /\bit(?:'s| is) not appropriate for me to\b/gi, weight: 1 },
  { re: /\[(?:your|insert|recipient(?:'s)?|company|client|customer|product)(?: [a-z']+){0,3}\]/gi, weight: 1 },
  { re: /\bi hope this (?:helps|information (?:helps|is helpful))\b/gi, weight: 0.5 },
  { re: /\bfeel free to (?:ask|reach out|let me know)\b/gi, weight: 0.5 },
];

/**
 * Explicit disclosure that the text itself is AI-generated. Treated as a
 * strong self-label rather than stylistic evidence.
 */
export const DISCLOSURE_PATTERNS = [
  /\b(?:this|the above|the following) (?:text|content|response|article|post|story|review|summary) (?:was|is|has been) (?:ai[- ]generated|(?:generated|written|created) (?:by|with|using) (?:ai|chatgpt|an ai|artificial intelligence|a language model))/gi,
  /\b(?:generated|written) (?:by|with) (?:chatgpt|gpt-\d|an ai assistant)\b/gi,
];

/**
 * Phrases disproportionately common in LLM prose. Each is plausible in human
 * writing, so they only add moderate evidence and are density-normalised.
 */
export const AI_PHRASE_PATTERNS = [
  /\bdelv(?:e|es|ed|ing) (?:into|deeper)\b/gi,
  /\bit(?:'s| is) (?:important|crucial|essential|worth|vital) (?:to note|noting|to remember|to consider|to understand|to recognize|mentioning)\b/gi,
  /\bin today's (?:fast-paced|digital|modern|ever-changing|rapidly evolving|interconnected|competitive|dynamic) (?:world|age|landscape|era|society|environment|market)\b/gi,
  /\bin the (?:ever-evolving|ever-changing|rapidly evolving|constantly evolving|dynamic) (?:world|landscape|realm|field|space) of\b/gi,
  /\b(?:rich|vibrant|intricate|diverse) tapestry\b/gi,
  /\b(?:a|stands as a|serves as a) testament to\b/gi,
  /\bnavigat(?:e|es|ing) the (?:complexities|intricacies|challenges|nuances|ever)/gi,
  /\bin the realm of\b/gi,
  /\bplays? a (?:crucial|pivotal|vital|significant|key|critical|central) role\b/gi,
  /\bunlock(?:s|ing)? the (?:full )?(?:potential|power|secrets)\b/gi,
  /\bharness(?:es|ing)? the (?:full )?(?:power|potential)\b/gi,
  /\bembark(?:s|ing)? on (?:a|an|your) (?:journey|adventure|quest)\b/gi,
  /\bwhether you(?:'re| are) an? [a-z-]+(?: [a-z-]+){0,3} or\b/gi,
  /\b(?:let's|let us) (?:dive|delve) (?:in|into|deeper)\b/gi,
  /\bdive (?:deep|deeper) into\b/gi,
  /\bwithout further ado\b/gi,
  /\bkey takeaways?\b/gi,
  /\bhere(?:'s| is) (?:a |an )?(?:breakdown|quick overview|step-by-step|comprehensive|detailed look)\b/gi,
  /\bhere are (?:some|a few|several)(?: [a-z-]+)? (?:tips|ways|key|strategies|steps|things|ideas|examples|factors|reasons|options|benefits)\b/gi,
  /\bby (?:following|implementing|incorporating|understanding|applying|embracing) these (?:tips|steps|strategies|practices|guidelines|principles|techniques)\b/gi,
  /\b(?:a|an absolute|a true|a real) game[- ]changer\b/gi,
  /\bseamless(?:ly)? (?:integrat|experience|blend|transition)/gi,
  /\belevate your\b/gi,
  /\btake your [a-z-]+(?: [a-z-]+){0,2} to the next level\b/gi,
  /\bfoster(?:s|ing)? (?:a sense of|collaboration|innovation|growth|meaningful|a culture)\b/gi,
  /\bnot only\b[^.!?\n]{3,80}\bbut also\b/gi,
  /\b(?:serves?|serving) as a (?:reminder|testament|catalyst|cornerstone|powerful)\b/gi,
  /\b(?:a|the) (?:myriad|plethora) of\b/gi,
  /\bpav(?:e|es|ing) the way (?:for|to)\b/gi,
  /\bnestled (?:in|among|within|between)\b/gi,
  /\bunderscor(?:es|ing|ed) the (?:importance|need|significance|value)\b/gi,
  /\bresonat(?:e|es|ing) with\b/gi,
  /\ba (?:wide|diverse|broad) (?:range|array|variety|spectrum) of\b/gi,
  /\b(?:offers?|provides?) (?:a |an )?(?:valuable|unique|deeper|invaluable) (?:insights?|perspective|opportunit)/gi,
  /\b(?:crucial|essential|vital|integral|key) (?:aspect|component|element|part) of\b/gi,
  /\bthe (?:intricacies|nuances|complexities) of\b/gi,
  /\bin (?:the|an|this) (?:age|era) of\b/gi,
  /\b(?:ever-evolving|ever-changing) (?:world|landscape|field)\b/gi,
  /\bthe best of both worlds\b/gi,
  /\bmake an informed decision\b/gi,
  /\bstrike a (?:balance|harmonious balance)\b/gi,
  /\bat the (?:heart|forefront|intersection) of\b/gi,
  /\bthe (?:possibilities|opportunities) are endless\b/gi,
  /\ba (?:deeper|better|greater) understanding of\b/gi,
  /\bin the (?:digital|modern) age\b/gi,
  /\bwell-positioned to\b/gi,
];

/** Single words LLMs overuse relative to typical human web text. */
export const AI_VOCABULARY = new Set([
  'delve', 'delves', 'delving', 'tapestry', 'testament', 'multifaceted', 'intricate', 'intricacies',
  'nuanced', 'pivotal', 'paramount', 'robust', 'seamless', 'seamlessly', 'leverage', 'leveraging',
  'utilize', 'utilizing', 'facilitate', 'facilitates', 'foster', 'fostering', 'holistic',
  'comprehensive', 'meticulous', 'meticulously', 'realm', 'landscape', 'embark', 'endeavor',
  'endeavors', 'vibrant', 'bustling', 'showcase', 'showcases', 'showcasing', 'underscore',
  'underscores', 'noteworthy', 'commendable', 'invaluable', 'transformative', 'cutting-edge',
  'groundbreaking', 'unparalleled', 'unwavering', 'empower', 'empowering', 'empowers', 'elevate',
  'elevates', 'enhance', 'enhancing', 'enhances', 'streamline', 'streamlines', 'optimize',
  'navigate', 'navigating', 'captivating', 'enthralling', 'resonate', 'resonates', 'synergy',
  'paradigm', 'ever-evolving', 'ever-changing', 'moreover', 'furthermore', 'additionally',
  'notably', 'ultimately', 'thereby', 'aforementioned', 'plethora', 'myriad', 'bolster',
  'spearhead', 'harness', 'unleash', 'beacon', 'cornerstone', 'interplay', 'labyrinth',
  'crucial', 'vital', 'essential', 'proactive', 'invaluable', 'insightful', 'thrive', 'thriving',
  'unlock', 'unlocking', 'embrace', 'embracing', 'dynamic', 'innovative', 'significantly',
  'effectively', 'efficiently', 'enriching', 'profound', 'fundamentally', 'well-crafted',
  'actionable', 'optimal', 'nestled', 'breathtaking', 'awe-inspiring', 'boasts', 'boasting',
]);

/** Sentence-initial transitions. `weight` < 1 for transitions humans also use a lot. */
export const TRANSITIONS = [
  ['furthermore', 1], ['moreover', 1], ['additionally', 1], ['in addition', 1], ['overall', 0.8],
  ['ultimately', 1], ['in conclusion', 1], ['in summary', 1], ['to summarize', 1], ['notably', 0.8],
  ['importantly', 0.8], ['first and foremost', 1], ['lastly', 0.8], ['in essence', 1],
  ['essentially', 0.6], ['consequently', 0.7], ['subsequently', 0.7], ['similarly', 0.5],
  ['conversely', 0.7], ['nevertheless', 0.5], ['nonetheless', 0.5], ['firstly', 0.9],
  ['secondly', 0.9], ['thirdly', 0.9], ['as a result', 0.6], ['on the other hand', 0.5],
  ['that said', 0.4], ['with that in mind', 1], ['to begin with', 0.7], ['by doing so', 1],
  ['in doing so', 0.8], ['therefore', 0.4], ['thus', 0.4], ['however', 0.3], ['finally', 0.3],
  ['at the same time', 0.5], ['in today', 1], ['by understanding', 1], ['by leveraging', 1],
  ['by implementing', 1], ['by prioritizing', 1], ['by embracing', 1], ['by following', 0.8],
];

/** Generic, content-free openings (checked against the first sentence). */
export const GENERIC_INTRO_PATTERNS = [
  /^in today's\b[^.]{0,60}\b(?:world|age|era|landscape|society|environment|market)\b/i,
  /^in (?:an?|the) (?:ever|rapidly|constantly)[- ](?:evolving|changing)\b/i,
  /^(?:when it comes to|in the (?:world|realm) of)\b/i,
  /^(?:have you ever (?:wondered|found yourself|thought)|are you (?:looking|struggling|tired|ready))\b/i,
  /^[^.]{0,80}\b(?:is|are|has become|have become|remains?) (?:an? )?(?:crucial|essential|vital|integral|important|key|fundamental|indispensable) (?:part|aspect|component|element|tool|skill|consideration|factor)\b/i,
  /^(?:imagine|picture this)\b/i,
  /^(?:certainly|sure|absolutely|of course|great question)[!,.]/i,
  /^in (?:this|the following) (?:article|guide|post|blog|piece)\b/i,
  /^as (?:technology|the world|society) (?:continues|evolves|advances)\b/i,
  /^(?:throughout history|since the dawn of|from the dawn of)\b/i,
  /^the (?:concept|idea|importance|significance|world) of\b[^.]{0,60}\b(?:is|has|cannot)\b/i,
  /^[^.]{0,60}\b(?:stands as|serves as) a\b/i,
  /^[^.]{0,80}\bhas (?:fundamentally |dramatically |significantly )?(?:changed|transformed|revolutionized|reshaped) (?:the way|how)\b/i,
];

/** Formulaic wrap-ups (checked against the final paragraph / sentences). */
export const CONCLUSION_PATTERNS = [
  /(?:^|\n|[.!?]\s+)(?:in conclusion|in summary|to (?:sum up|summarize|conclude|wrap up)|all in all|in essence|in short|the bottom line)[,:]/i,
  /(?:^|\n|[.!?]\s+)(?:overall|ultimately),/i,
  /\bby (?:following|implementing|understanding|incorporating|applying|embracing|carefully (?:weighing|considering)) these\b/i,
  /(?:^|[.!?]\s+)(?:remember|keep in mind)[,:]?\s/i,
  /\bwhether you(?:'re| are) an? [^.]{2,60} or\b/i,
  /\b(?:the key (?:is|lies in)|the possibilities are endless|the future (?:of [^.]{2,30})?(?:is|looks) bright|embrace the (?:journey|change|future))\b/i,
  /\b(?:highly recommended|a worthy addition|well worth (?:the|every))\b/i,
  /\b(?:consistency|patience|balance) is key\b/i,
];

/** Headings typical of templated, generated articles. */
export const FORMULAIC_HEADINGS = [
  /^(?:introduction|conclusion|final thoughts|key takeaways|in conclusion|summary|the bottom line|wrapping up)$/i,
  /^(?:understanding|exploring|the importance of|the benefits of|why [^?]{2,40} matters|the role of|the future of|the power of|unlocking|navigating|mastering)\b/i,
  /^(?:benefits|pros and cons|key (?:features|benefits|considerations|factors)|tips for|how to choose)\b/i,
];

/** Stock hedging and caveat phrases. */
export const HEDGE_PATTERNS = [
  /\bit(?:'s| is) (?:important|worth|essential|crucial) to (?:note|remember|consider|keep in mind)\b/gi,
  /\bit(?:'s| is) worth (?:noting|mentioning)\b/gi,
  /\b(?:may|can|will|might) vary (?:depending|based)\b/gi,
  /\bdepending on (?:your|the|their|individual) (?:specific |individual |unique |personal )?(?:needs|circumstances|situation|preferences|goals|requirements)\b/gi,
  /\bconsult(?:ing)? (?:with )?(?:a|an|your) (?:qualified |licensed |healthcare |medical |financial |legal )?(?:professional|doctor|expert|advisor|physician|specialist)\b/gi,
  /\bresults may vary\b/gi,
  /\bgenerally speaking\b/gi,
  /\bkeep in mind that\b/gi,
  /\bit(?:'s| is) (?:advisable|recommended) to\b/gi,
  /\b(?:your|their) (?:specific|individual|unique) (?:needs|circumstances|situation)\b/gi,
  /\bthere is no one-size-fits-all\b/gi,
  /\bultimately,? (?:the (?:best|right) (?:choice|approach|option)|it) (?:depends|comes down)\b/gi,
];

/** Tokens and emoticons typical of informal human writing. */
export const INFORMAL_TOKENS = new Set([
  'lol', 'lmao', 'lmfao', 'rofl', 'tbh', 'imo', 'imho', 'idk', 'idc', 'ngl', 'fwiw', 'afaik',
  'iirc', 'ymmv', 'smh', 'omg', 'wtf', 'btw', 'gonna', 'wanna', 'gotta', 'kinda', 'sorta',
  'dunno', "y'all", 'yall', 'yeah', 'yep', 'yup', 'nope', 'nah', 'meh', 'ugh', 'hmm', 'dude',
  'bro', 'lemme', 'gimme', 'cuz', 'tho', 'thx', 'pls', 'plz', 'ur', 'rn', 'af', 'bc', 'xd',
  'haha', 'hahaha', 'heh', 'jeez', 'whoa', 'yikes', 'oof', 'welp', 'anyways', 'tldr', 'eh',
  'huh', 'aww', 'lil', 'gotcha', 'lotta', 'outta', 'ain\'t', 'gonna', 'ya',
]);

/** Casual but also semi-formal words: count for half as much as INFORMAL_TOKENS. */
export const MILD_INFORMAL_TOKENS = new Set([
  'bucks', 'stuff', 'ok', 'okay', 'anyway', 'literally', 'wow', 'pretty', 'super', 'totally',
  'honestly', 'basically', 'guess', 'figured', 'weird', 'awesome', 'cool', 'crazy', 'mess',
  'stupid', 'dumb', 'annoying', 'tiny', 'huge',
]);

export const PROFANITY = new Set([
  'fuck', 'fucking', 'fucked', 'shit', 'shitty', 'damn', 'crap', 'crappy', 'hell', 'ass',
  'bullshit', 'goddamn', 'pissed', 'bloody', 'freaking', 'friggin', 'frickin',
]);

export const EMOTICON_RE = /(?:^|\s)(?::\)|:\(|:D|;\)|:P|:p|<3|:\/|xD|XD|:-\)|:-\(|\^\^)(?=\s|$)/g;

/** Words with a missing apostrophe — common in casual human typing. */
export const MISSING_APOSTROPHE = new Set([
  'dont', 'didnt', 'doesnt', 'isnt', 'wasnt', 'cant', 'wont', 'wouldnt', 'couldnt', 'shouldnt',
  'im', 'ive', 'id', 'thats', 'whats', 'theyre', 'youre', 'hes', 'shes', 'arent', 'havent',
]);

/** Personal, specific first-person narration markers. */
export const NARRATIVE_PATTERNS = [
  /\bmy (?:wife|husband|kid|kids|son|daughter|dad|mom|mum|mother|father|brother|sister|boss|girlfriend|boyfriend|partner|dog|cat|friend|neighbou?r|landlord|coworker|grandma|grandpa|roommate|uncle|aunt)\b/gi,
  /\blast (?:week|month|year|night|summer|winter|spring|fall|weekend|time i)\b/gi,
  /\b(?:yesterday|this morning|tonight|the other day)\b/gi,
  /\ba (?:few|couple(?: of)?) (?:days|weeks|months|years) ago\b/gi,
  /\b(?:when i was|i remember|i ended up|turned out|i used to|we used to|i tried|i bought|we went|i went)\b/gi,
  /\bback in (?:19|20)\d\d\b/gi,
];

/** Words that indicate text is *about* AI (quoted chatbot phrases are then discounted). */
export const AI_META_RE =
  /\b(?:chatgpt|gpt-?\d|openai|chatbots?|chat bots?|bots?|language models?|llms?|generative ai|ai[- ]generated|artificial intelligence|gemini|copilot|claude|anthropic|bard|ai tools?|ai assistants?)\b/gi;

/** Very common English function words — used to detect unsupported languages. */
export const ENGLISH_STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'of', 'to', 'in', 'on', 'for', 'with', 'is', 'are', 'was',
  'were', 'be', 'it', 'that', 'this', 'as', 'at', 'by', 'from', 'i', 'you', 'he', 'she', 'we',
  'they', 'not', 'have', 'has', 'had', 'do', 'does', 'did', 'my', 'your', 'our', 'their', 'his',
  'her', 'its', 'so', 'if', 'what', 'which', 'who', 'will', 'would', 'can', 'could', 'there',
  'about', 'just', 'more', 'some', 'all', 'one', 'been', 'when', 'out', 'up', 'no', 'than',
  'then', 'also', 'how', 'me', 'it\'s', 'don\'t', 'i\'m', 'these', 'those', 'into', 'any',
]);

/** Abbreviations that end with a period but do not end a sentence. */
export const ABBREVIATIONS = new Set([
  'e.g', 'i.e', 'etc', 'vs', 'mr', 'mrs', 'ms', 'dr', 'prof', 'sr', 'jr', 'st', 'mt', 'approx',
  'fig', 'inc', 'ltd', 'co', 'corp', 'dept', 'est', 'u.s', 'u.k', 'a.m', 'p.m', 'jan',
  'feb', 'mar', 'apr', 'jun', 'jul', 'aug', 'sep', 'sept', 'oct', 'nov', 'dec', 'vol', 'ed',
]);
