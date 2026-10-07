// Free, rule-based chat for the health assistant. Used when there is no AI key
// and when the phone is offline. It asks up to three short questions (what,
// since when, how bad), gives safe home-care tips and offers to book the
// earliest doctor in the right department. Emergencies always win.
//
// Wording must be reviewed by clinicians and native speakers before launch.
import { triage, offlineAdvice, isUrgent } from './triage.js';

const LANGS = ['en', 'te', 'hi', 'mr'];

// Department for booking, most specific first. Latin keywords match at a word start.
const DEPT_KEYWORDS = [
  ['pediatrics', { en: ['child', 'baby', 'kid', 'infant', 'my son', 'my daughter'], te: ['పిల్ల', 'బిడ్డ', 'బాబు', 'పాప'], hi: ['बच्च', 'बेटा', 'बेटी', 'शिशु'], mr: ['मूल', 'बाळ', 'मुलगा', 'मुलगी'] }],
  ['gynecology', { en: ['pregnan', 'period', 'menstru', 'white discharge'], te: ['గర్భ', 'నెలసరి', 'పీరియడ్'], hi: ['गर्भ', 'माहवारी', 'पीरियड'], mr: ['गर्भ', 'पाळी'] }],
  ['diabetes', { en: ['sugar', 'diabet', 'thyroid'], te: ['షుగర్', 'మధుమేహ', 'థైరాయిడ్'], hi: ['शुगर', 'मधुमेह', 'डायबिटीज', 'थायरॉइड'], mr: ['शुगर', 'मधुमेह', 'थायरॉईड'] }],
  ['cardiology', { en: ['heart', 'bp', 'blood pressure', 'palpitation'], te: ['గుండె', 'బీపీ'], hi: ['दिल', 'हृदय', 'बीपी', 'ब्लड प्रेशर'], mr: ['हृदय', 'बीपी'] }],
  ['eye', { en: ['eye', 'vision', 'cataract', 'blurred'], te: ['కన్ను', 'కంటి', 'చూపు'], hi: ['आँख', 'आंख', 'नज़र', 'मोतियाबिंद'], mr: ['डोळ', 'दृष्टी', 'मोतीबिंदू'] }],
  ['orthopedics', { en: ['bone', 'joint', 'knee', 'back pain', 'fracture', 'sprain', 'shoulder'], te: ['ఎముక', 'కీళ్ల', 'మోకాలు', 'నడుము'], hi: ['हड्डी', 'जोड़', 'घुटन', 'कमर'], mr: ['हाड', 'सांधे', 'गुडघ', 'पाठ'] }],
  ['neurology', { en: ['fits', 'seizure', 'numb', 'migraine', 'dizz'], te: ['ఫిట్స్', 'తిమ్మిర్లు', 'తల తిరుగు'], hi: ['दौरा', 'सुन्न', 'चक्कर', 'माइग्रेन'], mr: ['झटके', 'बधिर', 'चक्कर'] }],
];

// Everyday complaints that the triage list does not name; they go to General Medicine.
const MINOR = {
  en: ['cough', 'cold', 'stomach', 'pain', 'ache', 'itch', 'rash', 'weak', 'tired', 'acidity', 'throat', 'sick', 'unwell'],
  te: ['దగ్గు', 'జలుబు', 'కడుపు', 'నొప్పి', 'దురద', 'నీరసం', 'గొంతు'],
  hi: ['खांसी', 'खाँसी', 'जुकाम', 'सर्दी', 'पेट', 'दर्द', 'खुजली', 'कमज़ोरी', 'कमजोरी', 'गला', 'गले'],
  mr: ['खोकला', 'सर्दी', 'पोट', 'दुख', 'खाज', 'अशक्त', 'घसा'],
};

const GREET = /^\s*(hi|hello|hey|hii+|namaste|namaskar|good (morning|afternoon|evening))\b|నమస్తే|నమస్కారం|హలో|नमस्ते|नमस्कार|हेलो|हॅलो/i;
const HELP = /\b(what can you do|help me|who are you)\b|ఏం చేయగలవు|మీరు ఎవరు|क्या कर सकते|तुम कौन|आप कौन|काय करू शकता|तुम्ही कोण/i;
const MEDICINE = /\b(medicine|medicines|tablet|tablets|pill|pills|dose|dosage)\b|మందు|మాత్ర|दवा|दवाई|गोली|औषध|गोळी/i;
const EMERGENCY_WORD = /\b(emergency|ambulance|108|112)\b|అత్యవసర|అంబులెన్స్|ఆంబులెన్స్|आपातकाल|एम्बुलेंस|एंबुलेंस|आणीबाणी|रुग्णवाहिका/i;
const BOOK_INTENT = /\b(book|appointment|doctor|slot)|బుక్|అపాయింట్|డాక్టర్|बुक|अपॉइंट|डॉक्टर/i;
const THANKS = /\b(thank|thanks|thx|bye)|ధన్యవాద|థాంక్స్|धन्यवाद|शुक्रिया|आभार/i;
const LONG = /\b(week|month|[4-9]\s*days?|\d{2,}\s*days?)|వారం|నెల|हफ़्त|हफ्त|सप्ताह|महीन|आठवड|महिन/i;
const WORSE = /\b(worse|very bad|severe|unbearable|high)|పెరుగు|చాలా|ఎక్కువ|తీవ్ర|बढ़|बढ|बहुत|ज़्यादा|ज्यादा|तेज़|वाढ|खूप|जास्त/i;

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
function matches(text, words) {
  const t = text.toLowerCase();
  return Object.values(words)
    .flat()
    .some((k) => (/^[a-z ]+$/.test(k) ? new RegExp(`\\b${esc(k)}`).test(t) : t.includes(k.toLowerCase())));
}

/** Best department to book for this text, or null when nothing points anywhere. */
export function departmentFromText(text) {
  for (const [dept, words] of DEPT_KEYWORDS) if (matches(text, words)) return dept;
  const { codes } = triage(text);
  if (codes.includes('SEIZ') || codes.includes('STROKE')) return 'neurology';
  if (codes.includes('PREG')) return 'gynecology';
  if (codes.includes('ACCID')) return 'orthopedics';
  if (codes.length || matches(text, MINOR)) return 'general';
  return null;
}

/** "today" / "tomorrow" if the person said so, else null. */
export function dayFromText(text) {
  const t = text.toLowerCase();
  if (/\btomorrow\b|రేపు|कल|उद्या/.test(t)) return 'tomorrow';
  if (/\b(today|now|asap)\b|ఈరోజు|ఇప్పుడే|आज|अभी|आत्ता/.test(t)) return 'today';
  return null;
}

const Q = {
  what: {
    en: 'Tell me a little more. What do you feel? For example fever, cough, pain or a sugar problem.',
    te: 'ఇంకొంచెం చెప్పండి. మీకు ఏమి అనిపిస్తోంది? ఉదాహరణకు జ్వరం, దగ్గు, నొప్పి లేదా షుగర్ సమస్య.',
    hi: 'थोड़ा और बताइए। आपको क्या महसूस हो रहा है? जैसे बुखार, खांसी, दर्द या शुगर की समस्या।',
    mr: 'थोडं अजून सांगा. तुम्हाला काय जाणवतंय? उदा. ताप, खोकला, दुखणे किंवा शुगरचा त्रास.',
  },
  duration: {
    en: 'Since how many days do you have this?',
    te: 'ఇది ఎన్ని రోజుల నుండి ఉంది?',
    hi: 'यह कितने दिनों से है?',
    mr: 'हे किती दिवसांपासून आहे?',
  },
  how: {
    en: 'How bad is it now?',
    te: 'ఇప్పుడు ఎంత ఇబ్బందిగా ఉంది?',
    hi: 'अभी कितनी तकलीफ़ है?',
    mr: 'आत्ता किती त्रास होतोय?',
  },
};

const QUICK = {
  hello: {
    en: ['I feel unwell', 'Book a doctor', 'Medicine help', 'Emergency'],
    te: ['నాకు బాగోలేదు', 'డాక్టర్‌ను బుక్ చేయండి', 'మందుల సహాయం', 'అత్యవసరం'],
    hi: ['मेरी तबीयत ठीक नहीं', 'डॉक्टर बुक करें', 'दवा में मदद', 'आपातकाल'],
    mr: ['मला बरं वाटत नाही', 'डॉक्टर बुक करा', 'औषधांची मदत', 'आणीबाणी'],
  },
  what: {
    en: ['Fever', 'Cough and cold', 'Stomach pain', 'Sugar / BP check'],
    te: ['జ్వరం', 'దగ్గు, జలుబు', 'కడుపు నొప్పి', 'షుగర్ / బీపీ చెకప్'],
    hi: ['बुखार', 'खांसी-जुकाम', 'पेट दर्द', 'शुगर / बीपी जाँच'],
    mr: ['ताप', 'खोकला-सर्दी', 'पोटदुखी', 'शुगर / बीपी तपासणी'],
  },
  duration: {
    en: ['Since today', '2–3 days', 'More than a week'],
    te: ['ఈరోజు నుండి', '2–3 రోజులు', 'వారం కంటే ఎక్కువ'],
    hi: ['आज से', '2–3 दिन', 'एक हफ़्ते से ज़्यादा'],
    mr: ['आजपासून', '2–3 दिवस', 'आठवड्यापेक्षा जास्त'],
  },
  how: {
    en: ['Mild', 'Getting worse', 'Very bad'],
    te: ['కొంచెం', 'పెరుగుతోంది', 'చాలా ఎక్కువ'],
    hi: ['हल्की', 'बढ़ रही है', 'बहुत ज़्यादा'],
    mr: ['थोडासा', 'वाढतोय', 'खूप जास्त'],
  },
};

const TIPS = {
  FEVER: {
    en: 'For fever: drink water, ORS or coconut water, and rest. Adults can take paracetamol 500 mg up to 3 times a day. Children need a smaller dose, so ask a doctor.',
    te: 'జ్వరానికి: నీళ్ళు, ORS లేదా కొబ్బరి నీళ్ళు తాగండి, విశ్రాంతి తీసుకోండి. పెద్దలు పారాసెటమాల్ 500 mg రోజుకు 3 సార్ల వరకు వేసుకోవచ్చు. పిల్లలకు తక్కువ మోతాదు కావాలి, డాక్టర్‌ను అడగండి.',
    hi: 'बुखार में: पानी, ORS या नारियल पानी पिएँ और आराम करें। बड़े लोग पैरासिटामोल 500 mg दिन में 3 बार तक ले सकते हैं। बच्चों की खुराक कम होती है, डॉक्टर से पूछें।',
    mr: 'तापासाठी: पाणी, ORS किंवा नारळपाणी प्या आणि विश्रांती घ्या. मोठी माणसे पॅरासिटामॉल 500 mg दिवसातून 3 वेळा पर्यंत घेऊ शकतात. मुलांचा डोस कमी असतो, डॉक्टरांना विचारा.',
  },
  HEAD: {
    en: 'For headache: rest in a quiet, dark room, drink water and do not skip meals.',
    te: 'తలనొప్పికి: నిశ్శబ్దమైన, చీకటి గదిలో విశ్రాంతి తీసుకోండి, నీళ్ళు తాగండి, భోజనం మానకండి.',
    hi: 'सिरदर्द में: शांत, अँधेरे कमरे में आराम करें, पानी पिएँ और खाना न छोड़ें।',
    mr: 'डोकेदुखीसाठी: शांत, अंधाऱ्या खोलीत विश्रांती घ्या, पाणी प्या आणि जेवण चुकवू नका.',
  },
  VOMIT: {
    en: 'For vomiting or loose motions: take small sips of ORS often and eat light food like rice gruel. Very little urine or a dry mouth needs a doctor.',
    te: 'వాంతులు లేదా విరేచనాలకు: ORS కొంచెం కొంచెంగా తరచూ తాగండి, గంజి లాంటి తేలికపాటి ఆహారం తినండి. మూత్రం చాలా తక్కువగా వస్తే లేదా నోరు ఎండిపోతే డాక్టర్ అవసరం.',
    hi: 'उल्टी या दस्त में: थोड़ा-थोड़ा ORS बार-बार पिएँ और चावल का माँड़ जैसा हल्का खाना खाएँ। पेशाब बहुत कम हो या मुँह सूखे तो डॉक्टर ज़रूरी है।',
    mr: 'उलटी किंवा जुलाब असल्यास: ORS थोडं थोडं वारंवार प्या आणि पेजेसारखं हलकं अन्न खा. लघवी खूप कमी झाली किंवा तोंड कोरडं पडलं तर डॉक्टर आवश्यक आहेत.',
  },
  ACCID: {
    en: 'For a small injury: wash with clean water, press with a clean cloth if it bleeds, and keep the hurt part still.',
    te: 'చిన్న దెబ్బకు: శుభ్రమైన నీటితో కడగండి, రక్తం వస్తే శుభ్రమైన గుడ్డతో నొక్కి పట్టండి, దెబ్బ తగిలిన భాగాన్ని కదలనివ్వకండి.',
    hi: 'छोटी चोट में: साफ़ पानी से धोएँ, खून निकले तो साफ़ कपड़े से दबाएँ, और चोट वाले हिस्से को हिलाएँ नहीं।',
    mr: 'लहान दुखापतीसाठी: स्वच्छ पाण्याने धुवा, रक्त येत असल्यास स्वच्छ कापडाने दाबा आणि दुखापत झालेला भाग हलवू नका.',
  },
  BURN: {
    en: 'For burns: keep the burn under cool running water for 20 minutes. Do not put ice, toothpaste or oil.',
    te: 'కాలిన గాయానికి: 20 నిమిషాలు చల్లని పారే నీటి కింద ఉంచండి. ఐస్, టూత్‌పేస్ట్ లేదా నూనె పెట్టకండి.',
    hi: 'जलने पर: जले हिस्से को 20 मिनट ठंडे बहते पानी में रखें। बर्फ़, टूथपेस्ट या तेल न लगाएँ।',
    mr: 'भाजल्यास: भाजलेला भाग 20 मिनिटे थंड वाहत्या पाण्याखाली ठेवा. बर्फ, टूथपेस्ट किंवा तेल लावू नका.',
  },
  PREG: {
    en: 'In pregnancy, do not miss check-ups. Bleeding, strong pain or the baby moving less needs emergency help.',
    te: 'గర్భంలో ఉన్నప్పుడు చెకప్‌లు మానకండి. రక్తస్రావం, తీవ్రమైన నొప్పి లేదా బిడ్డ కదలికలు తగ్గితే వెంటనే అత్యవసర సహాయం తీసుకోండి.',
    hi: 'गर्भावस्था में जाँच न छोड़ें। खून आना, तेज़ दर्द या बच्चे का कम हिलना हो तो तुरंत आपातकालीन मदद लें।',
    mr: 'गर्भावस्थेत तपासण्या चुकवू नका. रक्तस्त्राव, तीव्र वेदना किंवा बाळाची हालचाल कमी झाल्यास लगेच आपत्कालीन मदत घ्या.',
  },
};

const LINES = {
  bookOffer: {
    en: 'Tap “Book fastest slot” below and I will find the earliest free doctor near you.',
    te: 'కింద “త్వరగా బుక్ చేయండి” నొక్కండి, మీ దగ్గరలో త్వరగా ఖాళీ ఉన్న డాక్టర్‌ను వెతుకుతాను.',
    hi: 'नीचे “जल्दी बुक करें” दबाएँ, मैं आपके पास सबसे पहले खाली डॉक्टर ढूँढ दूँगा।',
    mr: 'खाली “लवकर बुक करा” दाबा, मी तुमच्या जवळचा सर्वात लवकर मोकळा डॉक्टर शोधतो.',
  },
  hello: {
    en: 'Namaste! I am your health assistant. I can check how you feel, book the earliest doctor near you, help with your medicines, and get emergency help. How are you feeling today?',
    te: 'నమస్తే! నేను మీ ఆరోగ్య సహాయకుడిని. మీ లక్షణాలు చూడగలను, దగ్గరలో త్వరగా దొరికే డాక్టర్‌ను బుక్ చేయగలను, మందుల గురించి చెప్పగలను, అత్యవసర సహాయం అందించగలను. ఈరోజు మీకు ఎలా ఉంది?',
    hi: 'नमस्ते! मैं आपका स्वास्थ्य सहायक हूँ। मैं आपके लक्षण समझ सकता हूँ, पास में सबसे जल्दी मिलने वाला डॉक्टर बुक कर सकता हूँ, दवाइयों में मदद कर सकता हूँ और आपातकालीन मदद दिला सकता हूँ। आज आप कैसा महसूस कर रहे हैं?',
    mr: 'नमस्कार! मी तुमचा आरोग्य सहाय्यक आहे. मी तुमची लक्षणे समजू शकतो, जवळचे सर्वात लवकरचे डॉक्टर बुक करू शकतो, औषधांबद्दल मदत करू शकतो आणि आपत्कालीन मदत मिळवून देऊ शकतो. आज तुम्हाला कसं वाटतंय?',
  },
  medicine: {
    en: 'Take medicines exactly as your doctor wrote: at the same time every day, with water. Do not stop or change the dose without asking the doctor. Your medicine times are on the Home screen under “Today’s medicines”, and the app reminds you. If you get a rash, swelling or trouble breathing after a medicine, get emergency help at once.',
    te: 'డాక్టర్ రాసినట్లే మందులు వేసుకోండి: ప్రతిరోజూ అదే సమయానికి, నీళ్ళతో. డాక్టర్‌ను అడగకుండా ఆపకండి, మోతాదు మార్చకండి. మీ మందుల సమయాలు హోమ్ స్క్రీన్‌లో “ఈరోజు మందులు” కింద ఉన్నాయి, యాప్ గుర్తు చేస్తుంది. మందు తర్వాత దద్దుర్లు, వాపు లేదా ఊపిరి ఇబ్బంది వస్తే వెంటనే అత్యవసర సహాయం తీసుకోండి.',
    hi: 'दवाइयाँ ठीक वैसे ही लें जैसे डॉक्टर ने लिखा है: हर दिन एक ही समय पर, पानी के साथ। डॉक्टर से पूछे बिना दवा बंद न करें और खुराक न बदलें। आपकी दवा का समय होम स्क्रीन पर “आज की दवाइयाँ” में है, और ऐप याद दिलाता है। दवा के बाद दाने, सूजन या साँस में तकलीफ़ हो तो तुरंत आपातकालीन मदद लें।',
    mr: 'डॉक्टरांनी लिहिल्याप्रमाणेच औषधे घ्या: रोज त्याच वेळी, पाण्यासोबत. डॉक्टरांना विचारल्याशिवाय औषध बंद करू नका किंवा डोस बदलू नका. तुमच्या औषधांच्या वेळा होम स्क्रीनवर “आजची औषधे” मध्ये आहेत, आणि ॲप आठवण करून देते. औषधानंतर पुरळ, सूज किंवा श्वास घेण्यास त्रास झाल्यास लगेच आपत्कालीन मदत घ्या.',
  },
  thanks: {
    en: 'You are welcome. Take care. I am here any time. In an emergency press SOS or call 108.',
    te: 'సంతోషం. జాగ్రత్తగా ఉండండి. ఎప్పుడైనా అడగండి. అత్యవసరమైతే SOS నొక్కండి లేదా 108కి కాల్ చేయండి.',
    hi: 'आपका स्वागत है। ध्यान रखें। मैं कभी भी यहाँ हूँ। आपात स्थिति में SOS दबाएँ या 108 पर कॉल करें।',
    mr: 'आनंद आहे. काळजी घ्या. मी कधीही इथे आहे. आणीबाणीत SOS दाबा किंवा 108 वर कॉल करा.',
  },
};

const say = (row, lang) => row[lang] || row.en;

// Which question an assistant message asked (in any language), or null.
function questionOf(content) {
  for (const [key, row] of Object.entries(Q)) if (LANGS.some((l) => content === row[l])) return key;
  return null;
}

/**
 * @param {{role: 'user'|'assistant', content: string}[]} messages
 * @returns {{ reply: string, severity: string|null, codes: string[], department: string|null, quickReplies: string[], book: boolean }}
 */
export function chatReply(messages, lang = 'en') {
  const msgs = (messages || []).filter((m) => typeof m?.content === 'string');
  const last = msgs.findLast((m) => m.role === 'user')?.content ?? '';
  const out = (reply, extra = {}) => ({ reply, severity: null, codes: [], department: null, quickReplies: [], book: false, ...extra });

  // 1. Emergencies first, every time.
  const now = triage(last);
  if (isUrgent(now.severity)) return out(offlineAdvice(now.severity, lang), { severity: now.severity, codes: now.codes });

  // The current topic starts after the last full answer (an assistant message that was not a question).
  let start = 0;
  msgs.forEach((m, i) => {
    if (m.role === 'assistant' && !questionOf(m.content)) start = i + 1;
  });
  const topic = msgs.slice(start);
  const said = topic.filter((m) => m.role === 'user').map((m) => m.content).join('\n');
  const asked = new Set(topic.filter((m) => m.role === 'assistant').map((m) => questionOf(m.content)));
  const answerTo = (key) => {
    const i = topic.findIndex((m) => m.role === 'assistant' && questionOf(m.content) === key);
    return i >= 0 ? (topic.slice(i + 1).find((m) => m.role === 'user')?.content ?? '') : '';
  };

  const { codes, severity } = triage(said);
  if (isUrgent(severity)) return out(offlineAdvice(severity, lang), { severity, codes });
  const department = departmentFromText(said);

  if (EMERGENCY_WORD.test(last)) return out(offlineAdvice('critical', lang), { severity: 'critical', codes });
  if (!department && !codes.length && (GREET.test(last) || HELP.test(last))) {
    return out(say(LINES.hello, lang), { quickReplies: say(QUICK.hello, lang) });
  }
  if (MEDICINE.test(last) && !codes.length && !BOOK_INTENT.test(last)) return out(say(LINES.medicine, lang));
  if (THANKS.test(last) && !department) return out(say(LINES.thanks, lang));

  // 2. "Book a doctor for my sugar": go straight to booking.
  if (BOOK_INTENT.test(last)) {
    return out(say(LINES.bookOffer, lang), { severity, codes, department: department ?? 'general', book: true });
  }

  // 3. Up to three short questions.
  for (const key of ['what', 'duration', 'how']) {
    if (key === 'what' && department) continue;
    if (!asked.has(key)) return out(say(Q[key], lang), { severity, codes, department, quickReplies: say(QUICK[key], lang) });
  }

  // 4. Advice: longer than 3 days or getting worse means see a doctor today.
  const level = LONG.test(answerTo('duration')) || WORSE.test(answerTo('how')) || severity === 'medium' ? 'medium' : 'low';
  const tips = codes.filter((c) => TIPS[c]).map((c) => say(TIPS[c], lang));
  const reply = [...tips, offlineAdvice(level, lang), say(LINES.bookOffer, lang)].join('\n\n');
  return out(reply, { severity: level, codes, department: department ?? 'general', book: true });
}
