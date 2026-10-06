// Rule-based symptom triage. Runs on the phone with no internet, and on the
// server as a safety check before any AI call. It is deliberately simple and
// errs towards "get help": it only raises severity, never lowers it.
//
// Keywords must be reviewed by clinicians and native speakers before launch.

export const SEVERITIES = ['low', 'medium', 'high', 'critical'];

// weight: 4 = critical, 3 = high, 2 = medium, 1 = low
export const SYMPTOMS = {
  CHEST: {
    weight: 4,
    label: { en: 'Chest pain', te: 'ఛాతీ నొప్పి', hi: 'सीने में दर्द', mr: 'छातीत दुखणे' },
    keywords: {
      en: ['chest pain', 'chest', 'heart attack', 'heart pain'],
      te: ['ఛాతీ', 'గుండె నొప్పి'],
      hi: ['सीने में दर्द', 'छाती', 'सीना', 'दिल का दौरा'],
      mr: ['छातीत', 'छाती', 'हृदयविकार'],
    },
  },
  BREATH: {
    weight: 3,
    label: { en: 'Can’t breathe', te: 'ఊపిరి ఆడటం లేదు', hi: 'सांस नहीं आ रही', mr: 'श्वास घेता येत नाही' },
    keywords: {
      en: ['breath', 'breathing', 'suffocat', 'choking'],
      te: ['ఊపిరి', 'శ్వాస'],
      hi: ['सांस', 'साँस', 'दम घुट'],
      mr: ['श्वास', 'दम लाग'],
    },
  },
  UNCON: {
    weight: 4,
    label: { en: 'Unconscious', te: 'స్పృహ లేదు', hi: 'बेहोश', mr: 'बेशुद्ध' },
    keywords: {
      en: ['unconscious', 'fainted', 'not responding', 'collapsed'],
      te: ['స్పృహ', 'కళ్ళు తిరిగి పడిపోయ'],
      hi: ['बेहोश'],
      mr: ['बेशुद्ध'],
    },
  },
  STROKE: {
    weight: 4,
    label: { en: 'Stroke signs', te: 'పక్షవాతం లక్షణాలు', hi: 'लकवे के लक्षण', mr: 'अर्धांगवायूची लक्षणे' },
    keywords: {
      en: ['stroke', 'face droop', 'slurred', 'paralys', 'one side weak'],
      te: ['పక్షవాతం'],
      hi: ['लकवा'],
      mr: ['अर्धांगवायू', 'लकवा'],
    },
  },
  SNAKE: {
    weight: 4,
    label: { en: 'Snake bite', te: 'పాము కాటు', hi: 'सांप का काटना', mr: 'सर्पदंश' },
    keywords: { en: ['snake'], te: ['పాము'], hi: ['सांप', 'साँप'], mr: ['साप', 'सर्प'] },
  },
  POISON: {
    weight: 4,
    label: { en: 'Poisoning', te: 'విషం', hi: 'ज़हर', mr: 'विषबाधा' },
    keywords: {
      en: ['poison', 'pesticide', 'swallowed'],
      te: ['విషం', 'పురుగుమందు'],
      hi: ['ज़हर', 'जहर', 'कीटनाशक'],
      mr: ['विष', 'कीटकनाशक'],
    },
  },
  BLEED: {
    weight: 3,
    label: { en: 'Heavy bleeding', te: 'రక్తస్రావం', hi: 'खून बहना', mr: 'रक्तस्त्राव' },
    keywords: {
      en: ['bleeding', 'blood loss'],
      te: ['రక్తస్రావం', 'రక్తం'],
      hi: ['खून', 'रक्तस्राव'],
      mr: ['रक्तस्त्राव', 'रक्त वाह'],
    },
  },
  SEIZ: {
    weight: 3,
    label: { en: 'Fits / seizure', te: 'ఫిట్స్', hi: 'दौरा / मिर्गी', mr: 'झटके' },
    keywords: {
      en: ['seizure', 'fits', 'convulsion'],
      te: ['ఫిట్స్', 'మూర్ఛ'],
      hi: ['दौरा', 'मिर्गी'],
      mr: ['झटके', 'फेफरे'],
    },
  },
  ACCID: {
    weight: 2,
    label: { en: 'Accident / injury', te: 'ప్రమాదం', hi: 'दुर्घटना', mr: 'अपघात' },
    keywords: {
      en: ['accident', 'fell', 'fracture', 'crash', 'injur'],
      te: ['ప్రమాదం', 'దెబ్బ'],
      hi: ['दुर्घटना', 'एक्सीडेंट', 'चोट'],
      mr: ['अपघात', 'दुखापत'],
    },
  },
  PREG: {
    weight: 2,
    label: { en: 'Pregnancy problem', te: 'గర్భ సమస్య', hi: 'गर्भावस्था समस्या', mr: 'गर्भधारणा समस्या' },
    keywords: {
      en: ['pregnan', 'labour', 'labor pain', 'delivery'],
      te: ['గర్భ', 'ప్రసవ'],
      hi: ['गर्भ', 'प्रसव'],
      mr: ['गर्भ', 'प्रसूती'],
    },
  },
  BURN: {
    weight: 2,
    label: { en: 'Burns', te: 'కాలిన గాయాలు', hi: 'जलना', mr: 'भाजणे' },
    keywords: { en: ['burn'], te: ['కాలిన', 'కాలింది'], hi: ['जल गया', 'जला'], mr: ['भाजल'] },
  },
  FEVER: {
    weight: 1,
    label: { en: 'Fever', te: 'జ్వరం', hi: 'बुखार', mr: 'ताप' },
    keywords: { en: ['fever', 'temperature'], te: ['జ్వరం'], hi: ['बुखार'], mr: ['ताप'] },
  },
  HEAD: {
    weight: 1,
    label: { en: 'Headache', te: 'తలనొప్పి', hi: 'सिरदर्द', mr: 'डोकेदुखी' },
    keywords: { en: ['headache'], te: ['తలనొప్పి'], hi: ['सिरदर्द', 'सर दर्द'], mr: ['डोकेदुखी'] },
  },
  VOMIT: {
    weight: 1,
    label: { en: 'Vomiting / loose motions', te: 'వాంతులు / విరేచనాలు', hi: 'उल्टी / दस्त', mr: 'उलटी / जुलाब' },
    keywords: {
      en: ['vomit', 'diarrh', 'loose motion'],
      te: ['వాంతి', 'విరేచనాలు'],
      hi: ['उल्टी', 'दस्त'],
      mr: ['उलटी', 'जुलाब'],
    },
  },
};

// Codes shown as one-tap buttons on the emergency screen.
export const EMERGENCY_CODES = ['CHEST', 'BREATH', 'UNCON', 'BLEED', 'ACCID', 'PREG', 'SNAKE', 'BURN'];

// Combinations that are worse than their parts.
const COMBOS = [
  { codes: ['CHEST', 'BREATH'], weight: 4 },
  { codes: ['PREG', 'BLEED'], weight: 4 },
];

export function detectSymptoms(text) {
  const t = String(text || '').toLowerCase();
  const found = [];
  for (const [code, s] of Object.entries(SYMPTOMS)) {
    const all = Object.values(s.keywords).flat();
    if (all.some((k) => t.includes(k.toLowerCase()))) found.push(code);
  }
  return found;
}

export function severityFromCodes(codes) {
  const set = new Set(codes);
  let w = 0;
  for (const c of set) w = Math.max(w, SYMPTOMS[c]?.weight ?? 0);
  for (const combo of COMBOS) {
    if (combo.codes.every((c) => set.has(c))) w = Math.max(w, combo.weight);
  }
  if (w === 0) return null;
  return SEVERITIES[w - 1];
}

// triage('chest pain and hard to breathe') -> { codes: ['CHEST','BREATH'], severity: 'critical' }
export function triage(input) {
  const codes = Array.isArray(input) ? input.filter((c) => SYMPTOMS[c]) : detectSymptoms(input);
  return { codes, severity: severityFromCodes(codes) };
}

export function isUrgent(severity) {
  return severity === 'high' || severity === 'critical';
}

const ADVICE = {
  critical: {
    en: 'These signs can be life-threatening. Get help now: open Emergency or call 108. Stay still and keep your phone near you.',
    te: 'ఈ లక్షణాలు ప్రాణాపాయం కావచ్చు. వెంటనే సహాయం పొందండి: అత్యవసరం తెరవండి లేదా 108కి కాల్ చేయండి. కదలకుండా ఉండండి, ఫోన్ దగ్గర ఉంచుకోండి.',
    hi: 'ये लक्षण जानलेवा हो सकते हैं। तुरंत मदद लें: आपातकाल खोलें या 108 पर कॉल करें। हिलें नहीं और फ़ोन पास रखें।',
    mr: 'ही लक्षणे जीवघेणी असू शकतात. लगेच मदत घ्या: आणीबाणी उघडा किंवा 108 वर कॉल करा. हालचाल करू नका, फोन जवळ ठेवा.',
  },
  high: {
    en: 'This needs a doctor urgently. Go to the nearest emergency hospital now, or open Emergency if you cannot travel.',
    te: 'దీనికి వెంటనే డాక్టర్ అవసరం. దగ్గరి అత్యవసర ఆసుపత్రికి ఇప్పుడే వెళ్ళండి, లేదా ప్రయాణించలేకపోతే అత్యవసరం తెరవండి.',
    hi: 'इसके लिए तुरंत डॉक्टर ज़रूरी है। अभी नज़दीकी आपातकालीन अस्पताल जाएँ, या यात्रा न कर सकें तो आपातकाल खोलें।',
    mr: 'यासाठी तातडीने डॉक्टरांची गरज आहे. आत्ताच जवळच्या आपत्कालीन रुग्णालयात जा, किंवा प्रवास शक्य नसल्यास आणीबाणी उघडा.',
  },
  medium: {
    en: 'Please see a doctor today. You can book a visit or a video consult in the app.',
    te: 'దయచేసి ఈరోజే డాక్టర్‌ను కలవండి. యాప్‌లో అపాయింట్‌మెంట్ లేదా వీడియో సంప్రదింపు బుక్ చేయవచ్చు.',
    hi: 'कृपया आज ही डॉक्टर से मिलें। ऐप में अपॉइंटमेंट या वीडियो परामर्श बुक कर सकते हैं।',
    mr: 'कृपया आजच डॉक्टरांना भेटा. ॲपमध्ये भेट किंवा व्हिडिओ सल्ला बुक करू शकता.',
  },
  low: {
    en: 'Rest, drink plenty of water and watch your symptoms. If they last more than 3 days or get worse, book a doctor.',
    te: 'విశ్రాంతి తీసుకోండి, నీళ్ళు ఎక్కువగా తాగండి. 3 రోజులకు మించి ఉన్నా లేదా ఎక్కువైనా డాక్టర్‌ను బుక్ చేయండి.',
    hi: 'आराम करें, खूब पानी पिएँ और लक्षणों पर ध्यान रखें। 3 दिन से ज़्यादा रहें या बढ़ें तो डॉक्टर बुक करें।',
    mr: 'विश्रांती घ्या, भरपूर पाणी प्या. 3 दिवसांपेक्षा जास्त राहिल्यास किंवा वाढल्यास डॉक्टर बुक करा.',
  },
  none: {
    en: 'I could not recognise the symptoms offline. Describe them in simple words, or connect to the internet for the full assistant. In an emergency call 108.',
    te: 'ఆఫ్‌లైన్‌లో లక్షణాలు గుర్తించలేకపోయాను. సులభమైన మాటల్లో చెప్పండి, లేదా పూర్తి సహాయకుడి కోసం ఇంటర్నెట్‌కి కనెక్ట్ అవ్వండి. అత్యవసరమైతే 108కి కాల్ చేయండి.',
    hi: 'ऑफ़लाइन मैं लक्षण पहचान नहीं पाया। आसान शब्दों में बताएँ, या पूरे सहायक के लिए इंटरनेट से जुड़ें। आपात स्थिति में 108 पर कॉल करें।',
    mr: 'ऑफलाइन मला लक्षणे ओळखता आली नाहीत. सोप्या शब्दांत सांगा, किंवा पूर्ण सहाय्यकासाठी इंटरनेटशी जोडा. आणीबाणीत 108 वर कॉल करा.',
  },
};

export function offlineAdvice(severity, lang = 'en') {
  const row = ADVICE[severity || 'none'] || ADVICE.none;
  return row[lang] || row.en;
}
