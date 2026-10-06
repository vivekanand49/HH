// Content that is data rather than UI copy, in all four languages.
// Medical wording must be reviewed by clinicians and native speakers.
import i18n from '../i18n';

export const pick = (row) => row?.[i18n.language] ?? row?.en ?? '';

export const DEPARTMENTS = {
  general: {
    en: 'General Medicine',
    te: 'జనరల్ మెడిసిన్',
    hi: 'सामान्य चिकित्सा',
    mr: 'सामान्य औषधोपचार',
    hint: { en: 'Fever, BP, general', te: 'జ్వరం, బీపీ, సాధారణ', hi: 'बुखार, बीपी, सामान्य', mr: 'ताप, बीपी, सामान्य' },
  },
  diabetes: {
    en: 'Diabetes & Hormones',
    te: 'షుగర్ & హార్మోన్లు',
    hi: 'मधुमेह और हार्मोन',
    mr: 'मधुमेह व हार्मोन',
    hint: { en: 'Sugar, thyroid', te: 'షుగర్, థైరాయిడ్', hi: 'शुगर, थायरॉइड', mr: 'शुगर, थायरॉईड' },
  },
  cardiology: {
    en: 'Heart (Cardiology)',
    te: 'గుండె (కార్డియాలజీ)',
    hi: 'हृदय (कार्डियोलॉजी)',
    mr: 'हृदय (कार्डिओलॉजी)',
    hint: { en: 'Chest pain, BP', te: 'ఛాతీ నొప్పి, బీపీ', hi: 'सीने में दर्द, बीपी', mr: 'छातीत दुखणे, बीपी' },
  },
  pediatrics: {
    en: 'Children (Pediatrics)',
    te: 'పిల్లలు (పీడియాట్రిక్స్)',
    hi: 'बच्चे (बाल रोग)',
    mr: 'मुले (बालरोग)',
    hint: { en: 'Under 14 years', te: '14 ఏళ్ల లోపు', hi: '14 वर्ष से कम', mr: '14 वर्षांखालील' },
  },
  gynecology: {
    en: 'Women (Gynecology)',
    te: 'మహిళలు (గైనకాలజీ)',
    hi: 'महिलाएँ (स्त्री रोग)',
    mr: 'महिला (स्त्रीरोग)',
    hint: { en: 'Pregnancy care', te: 'గర్భిణీ సంరక్షణ', hi: 'गर्भावस्था देखभाल', mr: 'गर्भावस्था काळजी' },
  },
  orthopedics: {
    en: 'Bones (Orthopedics)',
    te: 'ఎముకలు (ఆర్థోపెడిక్స్)',
    hi: 'हड्डी (ऑर्थोपेडिक्स)',
    mr: 'हाडे (अस्थिरोग)',
    hint: { en: 'Joint, back pain', te: 'కీళ్ల, నడుము నొప్పి', hi: 'जोड़, कमर दर्द', mr: 'सांधे, पाठदुखी' },
  },
  eye: { en: 'Eye', te: 'కంటి', hi: 'आँख', mr: 'डोळे', hint: { en: 'Vision, cataract', te: 'చూపు, శుక్లం', hi: 'नज़र, मोतियाबिंद', mr: 'दृष्टी, मोतीबिंदू' } },
  neurology: {
    en: 'Brain & Nerves',
    te: 'మెదడు & నరాలు',
    hi: 'दिमाग और नसें',
    mr: 'मेंदू व नसा',
    hint: { en: 'Fits, stroke', te: 'ఫిట్స్, పక్షవాతం', hi: 'दौरे, लकवा', mr: 'झटके, अर्धांगवायू' },
  },
};

export const deptLabel = (key) => pick(DEPARTMENTS[key]) || key;

export const FIRST_AID = [
  {
    id: 'cpr',
    title: { en: 'Not breathing (CPR)', te: 'ఊపిరి లేదు (CPR)', hi: 'सांस नहीं (CPR)', mr: 'श्वास नाही (CPR)' },
    steps: {
      en: [
        'Call 108 first, or ask someone to call.',
        'Push hard and fast in the centre of the chest, about 2 per second, 5 cm deep.',
        'Do not stop until help arrives or the person breathes normally.',
      ],
      te: [
        'ముందు 108కి కాల్ చేయండి, లేదా ఎవరినైనా చేయమనండి.',
        'ఛాతీ మధ్యలో గట్టిగా, వేగంగా నొక్కండి, సెకనుకు సుమారు 2 సార్లు, 5 సెం.మీ. లోతు.',
        'సహాయం వచ్చే వరకు లేదా వ్యక్తి సాధారణంగా శ్వాస తీసుకునే వరకు ఆపకండి.',
      ],
      hi: [
        'पहले 108 पर कॉल करें, या किसी से करवाएँ।',
        'छाती के बीच में ज़ोर से और तेज़ी से दबाएँ, लगभग 2 बार प्रति सेकंड, 5 सेमी गहरा।',
        'मदद आने तक या व्यक्ति के सामान्य सांस लेने तक न रुकें।',
      ],
      mr: [
        'आधी 108 वर कॉल करा, किंवा कोणाला तरी करायला सांगा.',
        'छातीच्या मध्यभागी जोरात आणि वेगाने दाबा, सेकंदाला सुमारे 2 वेळा, 5 सेमी खोल.',
        'मदत येईपर्यंत किंवा व्यक्ती नीट श्वास घेईपर्यंत थांबू नका.',
      ],
    },
  },
  {
    id: 'bleeding',
    title: { en: 'Heavy bleeding', te: 'ఎక్కువ రక్తస్రావం', hi: 'ज़्यादा खून बहना', mr: 'जास्त रक्तस्त्राव' },
    steps: {
      en: [
        'Press firmly on the wound with a clean cloth.',
        'Keep pressing. Do not lift to check; add more cloth on top.',
        'Raise the injured part if you can, and call 108.',
      ],
      te: [
        'శుభ్రమైన గుడ్డతో గాయంపై గట్టిగా నొక్కండి.',
        'నొక్కుతూనే ఉండండి. చూడటానికి ఎత్తకండి; పైన మరో గుడ్డ వేయండి.',
        'వీలైతే గాయపడిన భాగాన్ని పైకి ఎత్తండి, 108కి కాల్ చేయండి.',
      ],
      hi: [
        'साफ़ कपड़े से घाव पर ज़ोर से दबाएँ।',
        'दबाते रहें। देखने के लिए न उठाएँ; ऊपर और कपड़ा रखें।',
        'हो सके तो चोट वाले हिस्से को ऊपर उठाएँ और 108 पर कॉल करें।',
      ],
      mr: ['स्वच्छ कापडाने जखमेवर घट्ट दाबा.', 'दाबत राहा. पाहण्यासाठी उचलू नका; वर आणखी कापड ठेवा.', 'शक्य असल्यास जखमी भाग वर उचला आणि 108 वर कॉल करा.'],
    },
  },
  {
    id: 'snake',
    title: { en: 'Snake bite', te: 'పాము కాటు', hi: 'सांप का काटना', mr: 'सर्पदंश' },
    steps: {
      en: [
        'Keep the person calm and still. Keep the bitten arm or leg still and low.',
        'Remove rings and tight things. Do not cut, suck or tie the bite tightly.',
        'Go to the nearest government hospital now for anti-snake venom.',
      ],
      te: [
        'వ్యక్తిని ప్రశాంతంగా, కదలకుండా ఉంచండి. కాటు వేసిన చేయి లేదా కాలును కదపకుండా కిందికి ఉంచండి.',
        'ఉంగరాలు, బిగుతైనవి తీసేయండి. కోయవద్దు, పీల్చవద్దు, గట్టిగా కట్టవద్దు.',
        'పాము విషానికి మందు కోసం వెంటనే దగ్గరి ప్రభుత్వ ఆసుపత్రికి వెళ్ళండి.',
      ],
      hi: [
        'व्यक्ति को शांत और स्थिर रखें। काटे गए हाथ या पैर को स्थिर और नीचे रखें।',
        'अंगूठी और कसी चीज़ें उतार दें। न काटें, न चूसें, न कसकर बाँधें।',
        'एंटी-स्नेक वेनम के लिए तुरंत नज़दीकी सरकारी अस्पताल जाएँ।',
      ],
      mr: [
        'व्यक्तीला शांत आणि स्थिर ठेवा. चावलेला हात किंवा पाय स्थिर आणि खाली ठेवा.',
        'अंगठ्या व घट्ट वस्तू काढा. कापू नका, चोखू नका, घट्ट बांधू नका.',
        'सर्पविषावरील औषधासाठी लगेच जवळच्या सरकारी रुग्णालयात जा.',
      ],
    },
  },
  {
    id: 'burns',
    title: { en: 'Burns', te: 'కాలిన గాయాలు', hi: 'जलना', mr: 'भाजणे' },
    steps: {
      en: [
        'Cool the burn under clean running water for 20 minutes.',
        'Take off rings and watches. Do not pull off clothing stuck to the skin.',
        'Cover loosely with a clean cloth. No toothpaste, oil or ice.',
      ],
      te: [
        'కాలిన చోట 20 నిమిషాలు శుభ్రమైన పారే నీళ్ళు పోయండి.',
        'ఉంగరాలు, వాచీ తీసేయండి. చర్మానికి అంటుకున్న బట్టలు లాగవద్దు.',
        'శుభ్రమైన గుడ్డతో వదులుగా కప్పండి. టూత్‌పేస్ట్, నూనె, ఐస్ వద్దు.',
      ],
      hi: [
        'जले हिस्से पर 20 मिनट तक साफ़ बहता पानी डालें।',
        'अंगूठी और घड़ी उतार दें। त्वचा से चिपके कपड़े न खींचें।',
        'साफ़ कपड़े से ढीला ढकें। टूथपेस्ट, तेल या बर्फ़ न लगाएँ।',
      ],
      mr: [
        'भाजलेल्या भागावर 20 मिनिटे स्वच्छ वाहते पाणी सोडा.',
        'अंगठ्या व घड्याळ काढा. त्वचेला चिकटलेले कपडे ओढू नका.',
        'स्वच्छ कापडाने सैल झाका. टूथपेस्ट, तेल किंवा बर्फ लावू नका.',
      ],
    },
  },
];

// How a family member is related to the account holder.
export const RELATIONS = {
  child: { en: 'Child', te: 'బిడ్డ', hi: 'बच्चा', mr: 'मूल' },
  parent: { en: 'Parent', te: 'తల్లి / తండ్రి', hi: 'माता / पिता', mr: 'आई / वडील' },
  spouse: { en: 'Husband / wife', te: 'భర్త / భార్య', hi: 'पति / पत्नी', mr: 'पती / पत्नी' },
  grandparent: { en: 'Grandparent', te: 'తాత / అమ్మమ్మ', hi: 'दादा-दादी / नाना-नानी', mr: 'आजी / आजोबा' },
  sibling: { en: 'Brother / sister', te: 'అన్న / తమ్ముడు / అక్క / చెల్లి', hi: 'भाई / बहन', mr: 'भाऊ / बहीण' },
  grandchild: { en: 'Grandchild', te: 'మనవడు / మనవరాలు', hi: 'पोता / पोती', mr: 'नातू / नात' },
  other: { en: 'Other', te: 'ఇతర', hi: 'अन्य', mr: 'इतर' },
};

export const relationLabel = (key) => pick(RELATIONS[key]) || key;

// Whole years from a YYYY-MM-DD date of birth.
export function ageYears(dob) {
  if (!dob) return null;
  const d = new Date(dob);
  const now = new Date();
  let age = now.getFullYear() - d.getFullYear();
  if (now.getMonth() < d.getMonth() || (now.getMonth() === d.getMonth() && now.getDate() < d.getDate())) age--;
  return age >= 0 ? age : null;
}
