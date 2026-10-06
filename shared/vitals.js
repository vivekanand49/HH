// Readings a health worker should act on today. Deliberately simple and
// cautious; thresholds must be confirmed by the programme's clinicians.
export function flagVitals(v) {
  const flags = [];
  if (v.systolic >= 180 || v.diastolic >= 120) flags.push('bp_crisis');
  else if (v.systolic >= 140 || v.diastolic >= 90) flags.push('bp_high');
  if (v.sugar_mgdl != null && v.sugar_mgdl < 70) flags.push('sugar_low');
  if (v.sugar_mgdl >= 300) flags.push('sugar_very_high');
  if (v.spo2 != null && v.spo2 < 92) flags.push('oxygen_low');
  if (v.temperature_f >= 103) flags.push('fever_high');
  return flags;
}

export const FLAG_TEXT = {
  bp_crisis: {
    en: 'BP dangerously high. Arrange a doctor today; if chest pain, headache or weakness, call 108.',
    te: 'బీపీ ప్రమాదకరంగా ఎక్కువ. ఈరోజే డాక్టర్‌ను చూపించండి; ఛాతీ నొప్పి, తలనొప్పి లేదా బలహీనత ఉంటే 108కి కాల్ చేయండి.',
    hi: 'बीपी ख़तरनाक रूप से ज़्यादा। आज ही डॉक्टर को दिखाएँ; सीने में दर्द, सिरदर्द या कमज़ोरी हो तो 108 पर कॉल करें।',
    mr: 'बीपी धोकादायकरीत्या जास्त. आजच डॉक्टरांना दाखवा; छातीत दुखणे, डोकेदुखी किंवा अशक्तपणा असल्यास 108 वर कॉल करा.',
  },
  bp_high: { en: 'BP high. Book a check-up this week.', te: 'బీపీ ఎక్కువ. ఈ వారం పరీక్ష బుక్ చేయండి.', hi: 'बीपी ज़्यादा। इस हफ़्ते जाँच बुक करें।', mr: 'बीपी जास्त. या आठवड्यात तपासणी बुक करा.' },
  sugar_low: {
    en: 'Sugar low. Give sugar, juice or sweet food now and check again in 15 minutes.',
    te: 'షుగర్ తక్కువ. వెంటనే చక్కెర, జ్యూస్ లేదా తీపి ఇవ్వండి, 15 నిమిషాల్లో మళ్ళీ చూడండి.',
    hi: 'शुगर कम। अभी चीनी, जूस या मीठा दें और 15 मिनट में फिर जाँचें।',
    mr: 'शुगर कमी. लगेच साखर, रस किंवा गोड द्या आणि 15 मिनिटांनी पुन्हा तपासा.',
  },
  sugar_very_high: { en: 'Sugar very high. See a doctor today.', te: 'షుగర్ చాలా ఎక్కువ. ఈరోజే డాక్టర్‌ను చూపించండి.', hi: 'शुगर बहुत ज़्यादा। आज ही डॉक्टर को दिखाएँ।', mr: 'शुगर खूप जास्त. आजच डॉक्टरांना दाखवा.' },
  oxygen_low: { en: 'Oxygen low. Get emergency help now (108).', te: 'ఆక్సిజన్ తక్కువ. వెంటనే అత్యవసర సహాయం పొందండి (108).', hi: 'ऑक्सीजन कम। तुरंत आपातकालीन मदद लें (108)।', mr: 'ऑक्सिजन कमी. लगेच आपत्कालीन मदत घ्या (108).' },
  fever_high: { en: 'High fever. See a doctor today; give fluids.', te: 'ఎక్కువ జ్వరం. ఈరోజే డాక్టర్‌ను చూపించండి; నీళ్ళు ఎక్కువగా ఇవ్వండి.', hi: 'तेज़ बुखार। आज ही डॉक्टर को दिखाएँ; खूब पानी दें।', mr: 'जास्त ताप. आजच डॉक्टरांना दाखवा; भरपूर पाणी द्या.' },
};
