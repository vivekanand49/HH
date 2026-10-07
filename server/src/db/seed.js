// Demo data for Visakhapatnam. Government hospital names are real; their
// coordinates are approximate and bed counts are made up. Private hospitals,
// doctors and patients are fictional. Replace with the NHA Health Facility
// Registry / Health Professional Registry before any pilot.
import { one, query } from './index.js';
import { idHash, newSosCode } from '../services/ids.js';

export const DEPARTMENTS = ['general', 'diabetes', 'cardiology', 'pediatrics', 'gynecology', 'orthopedics', 'eye', 'neurology'];

const HOSPITALS = [
  { key: 'kgh', name: 'King George Hospital (KGH)', type: 'government', area: 'Maharanipeta', address: 'Maharanipeta, Visakhapatnam 530002', lat: 17.7105, lng: 83.3053, er: true, beds: 38, erBeds: 6, depts: DEPARTMENTS },
  { key: 'vic', name: 'Government Victoria Hospital', type: 'government', area: 'One Town', address: 'Chengal Rao Peta, Visakhapatnam 530001', lat: 17.701, lng: 83.293, er: true, beds: 12, erBeds: 2, depts: ['gynecology', 'pediatrics'] },
  { key: 'phc', name: 'Urban PHC, Gajuwaka', type: 'government', area: 'Gajuwaka', address: 'Main Road, Gajuwaka, Visakhapatnam 530026', lat: 17.686, lng: 83.208, er: false, beds: 0, erBeds: 0, depts: ['general', 'diabetes', 'pediatrics'] },
  { key: 'akp', name: 'Area Hospital, Anakapalli', type: 'government', area: 'Anakapalli', address: 'Anakapalli 531001', lat: 17.6913, lng: 83.0037, er: true, beds: 20, erBeds: 3, depts: ['general', 'gynecology', 'orthopedics', 'pediatrics'] },
  { key: 'pdt', name: 'Community Health Centre, Pendurthi', type: 'government', area: 'Pendurthi', address: 'Pendurthi, Visakhapatnam 531173', lat: 17.8265, lng: 83.2045, er: true, beds: 8, erBeds: 1, depts: ['general', 'pediatrics'] },
  { key: 'sea', name: 'Seaview Multispeciality (demo)', type: 'private', area: 'Gajuwaka', address: 'BHPV Road, Gajuwaka, Visakhapatnam 530012', lat: 17.6935, lng: 83.219, er: true, beds: 9, erBeds: 3, depts: ['general', 'cardiology', 'orthopedics', 'neurology'] },
  { key: 'hhi', name: 'Harbour Heart Institute (demo)', type: 'private', area: 'Dwaraka Nagar', address: 'Dwaraka Nagar, Visakhapatnam 530016', lat: 17.729, lng: 83.3085, er: true, beds: 4, erBeds: 2, depts: ['cardiology', 'general'] },
  { key: 'lot', name: 'Lotus Children’s Clinic (demo)', type: 'private', area: 'MVP Colony', address: 'MVP Colony, Visakhapatnam 530017', lat: 17.7447, lng: 83.334, er: false, beds: 0, erBeds: 0, depts: ['pediatrics'] },
];

// [hospital, name, department, years, languages, fee, block, room, rating]
const DOCTORS = [
  ['kgh', 'Dr. Ramesh Varma', 'general', 15, ['Telugu', 'English', 'Hindi'], 0, 'B', '202', 4.8],
  ['kgh', 'Dr. Sujatha Rao', 'general', 9, ['Telugu', 'English'], 0, 'B', '204', 4.6],
  ['kgh', 'Dr. Imran Shaik', 'diabetes', 11, ['Telugu', 'Hindi', 'Urdu', 'English'], 0, 'C', '110', 4.5],
  ['kgh', 'Dr. K. Srinivas', 'cardiology', 18, ['Telugu', 'English'], 0, 'D', '301', 4.7],
  ['kgh', 'Dr. Padmaja N.', 'pediatrics', 12, ['Telugu', 'English'], 0, 'A', '015', 4.6],
  ['kgh', 'Dr. Anil Kumar', 'orthopedics', 10, ['Telugu', 'Hindi', 'English'], 0, 'E', '120', 4.4],
  ['kgh', 'Dr. Meena Joshi', 'neurology', 14, ['Marathi', 'Hindi', 'English'], 0, 'D', '310', 4.6],
  ['kgh', 'Dr. V. Lakshmi', 'eye', 8, ['Telugu', 'English'], 0, 'F', '005', 4.5],
  ['kgh', 'Dr. Swathi Reddy', 'gynecology', 13, ['Telugu', 'English', 'Hindi'], 0, 'A', '022', 4.7],
  ['vic', 'Dr. Hema Latha', 'gynecology', 16, ['Telugu', 'English'], 0, 'A', '101', 4.7],
  ['vic', 'Dr. Suresh Babu', 'pediatrics', 7, ['Telugu', 'English'], 0, 'B', '008', 4.4],
  ['phc', 'Dr. Mounika P.', 'general', 5, ['Telugu', 'English', 'Hindi'], 0, 'A', '3', 4.5],
  ['phc', 'Dr. Ravi Teja', 'diabetes', 6, ['Telugu', 'English'], 0, 'A', '4', 4.3],
  ['akp', 'Dr. G. Prasad', 'general', 20, ['Telugu', 'English'], 0, 'A', '12', 4.6],
  ['akp', 'Dr. Aparna S.', 'gynecology', 9, ['Telugu', 'English'], 0, 'B', '21', 4.5],
  ['pdt', 'Dr. Kiran Kumar', 'general', 4, ['Telugu', 'English', 'Hindi'], 0, 'A', '2', 4.2],
  ['sea', 'Dr. Kavya Reddy', 'general', 12, ['Telugu', 'English'], 400, 'G', '12', 4.9],
  ['sea', 'Dr. Arjun Naidu', 'cardiology', 8, ['Telugu', 'English', 'Hindi'], 700, 'G', '31', 4.7],
  ['sea', 'Dr. Farhan Ali', 'orthopedics', 10, ['Hindi', 'Urdu', 'English', 'Telugu'], 600, 'G', '22', 4.6],
  ['sea', 'Dr. Sneha Deshpande', 'neurology', 15, ['Marathi', 'Hindi', 'English'], 800, 'G', '40', 4.8],
  ['hhi', 'Dr. Meera Kulkarni', 'cardiology', 20, ['Marathi', 'Hindi', 'English'], 800, 'H', '5', 4.8],
  ['hhi', 'Dr. Naveen Chowdary', 'general', 7, ['Telugu', 'English'], 400, 'H', '2', 4.5],
  ['lot', 'Dr. Deepa Rani', 'pediatrics', 11, ['Telugu', 'English', 'Hindi'], 500, 'A', '1', 4.9],
];

const AMBULANCES = [
  ['AP31TA1082', 'Suresh', '+919988776655', 17.69, 83.215],
  ['AP31TA1090', 'Venkatesh', '+919988776656', 17.72, 83.3],
  ['AP31TA1101', 'Nagaraju', '+919988776657', 17.83, 83.21],
  ['AP31TA1115', 'Rambabu', '+919988776658', 17.692, 83.01],
];

export async function seed() {
  const ids = {};
  for (const h of HOSPITALS) {
    const row = await one(
      `INSERT INTO hospitals (name, type, area, address, lat, lng, phone, emergency_phone, sms_number, departments, has_emergency, beds_free, er_beds_free, beds_total, er_beds_total, beds_updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15, now()) RETURNING id`,
      [h.name, h.type, h.area, h.address, h.lat, h.lng, '+910000000100', h.er ? '+910000000108' : null, '+910000000200', h.depts, h.er, h.beds, h.erBeds, h.beds * 4, h.erBeds * 2],
    );
    ids[h.key] = row.id;
  }

  for (const [key, name, dept, years, langs, fee, block, room, rating] of DOCTORS) {
    await query(
      `INSERT INTO doctors (hospital_id, full_name, department, qualifications, experience_years, languages, fee_inr, video_fee_inr, opd_block, room, rating)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [ids[key], name, dept, ['MBBS', dept === 'general' ? 'MD' : 'MS / DM'], years, langs, fee, fee ? Math.round(fee * 0.75) : 0, block, room, rating],
    );
  }

  await topUpDemoSlots();

  for (const [reg, driver, phone, lat, lng] of AMBULANCES) {
    await query(`INSERT INTO ambulances (registration, driver_name, driver_phone, lat, lng) VALUES ($1,$2,$3,$4,$5)`, [reg, driver, phone, lat, lng]);
  }

  // Demo patient. Sign in with mobile 9876543210, or Aadhaar 2345 6789 0123
  // (not a real Aadhaar), or ABHA 91-1234-5678-9012.
  const patient = await one(
    `INSERT INTO users (role, full_name, phone, aadhaar_hash, aadhaar_last4, abha_number, sos_code, date_of_birth, gender, blood_group, language,
                        address, lat, lng, location_updated_at, emergency_contact_name, emergency_contact_phone, records_consent_at)
     VALUES ('patient', 'Lakshmi Devi', '+919876543210', $1, '0123', '91-1234-5678-9012', $2, '1964-03-12', 'female', 'B+', 'en',
             'Near bus depot, Gajuwaka, Visakhapatnam', 17.6912, 83.2178, now(), 'Ravi (son)', '+919876500001', now())
     RETURNING id`,
    [idHash('aadhaar:234567890123'), newSosCode()],
  );
  const p = patient.id;
  const doc = async (name) => (await one(`SELECT id, hospital_id FROM doctors WHERE full_name = $1`, [name]));
  const ramesh = await doc('Dr. Ramesh Varma');

  const records = [
    ['lab', 'Blood sugar (HbA1c)', '7.4% · a little high', 3, ids.kgh, ramesh.id],
    ['prescription', 'Prescription · Dr. Ramesh Varma', 'Metformin 500 mg twice daily, Amlodipine 5 mg once daily · 30 days', 3, ids.kgh, ramesh.id],
    ['imaging', 'Chest X-ray', 'Normal', 7, ids.sea, null],
    ['lab', 'Cholesterol (lipid profile)', 'LDL 128 mg/dL · borderline', 15, ids.phc, null],
    ['imaging', 'ECG', 'Normal rhythm', 20, ids.sea, null],
    ['discharge', 'Discharge summary · viral fever', '3 days admitted, recovered', 75, ids.vic, null],
    ['vaccination', 'Tetanus vaccine', 'Next dose due in 10 years', 206, ids.phc, null],
  ];
  let rxId = null;
  for (const [kind, title, summary, daysAgo, hid, did] of records) {
    const rec = await one(
      `INSERT INTO medical_records (patient_id, hospital_id, doctor_id, kind, title, summary, recorded_on)
       VALUES ($1,$2,$3,$4,$5,$6, current_date - $7::int) RETURNING id`,
      [p, hid, did, kind, title, summary, daysAgo],
    );
    if (kind === 'prescription') rxId = rec.id;
  }

  await query(
    `INSERT INTO medications (patient_id, record_id, name, dose, times, instructions, start_date, end_date) VALUES
       ($1, $2, 'Metformin', '500 mg', ARRAY['08:00','20:00'], 'After food', current_date - 3, current_date + 27),
       ($1, $2, 'Amlodipine', '5 mg', ARRAY['09:00'], 'Once a day', current_date - 3, current_date + 27)`,
    [p, rxId],
  );
  await query(
    `INSERT INTO health_conditions (patient_id, kind, name, status) VALUES
       ($1, 'condition', 'Hypertension', 'ongoing'),
       ($1, 'condition', 'Type 2 diabetes', 'ongoing'),
       ($1, 'allergy', 'Penicillin', 'ongoing')`,
    [p],
  );

  // Staff logins (mobile OTP): KGH emergency desk and 108 dispatch.
  await query(
    `INSERT INTO users (role, full_name, phone, sos_code, hospital_id) VALUES
       ('hospital_staff', 'Dr. P. Anitha (KGH duty doctor)', '+919000000001', $1, $2),
       ('dispatcher', '108 Control Room (demo)', '+919000000002', $3, NULL),
       ('hospital_admin', 'KGH Hospital Admin (demo)', '+919000000005', $4, $2),
       ('admin', 'District Health Office (demo)', '+919000000006', $5, NULL)`,
    [newSosCode(), ids.kgh, newSosCode(), newSosCode(), newSosCode()],
  );

  // Doctor login (mobile OTP) linked to Dr. Ramesh Varma, who works in Telugu.
  const doctorUser = await one(
    `INSERT INTO users (role, full_name, phone, sos_code, hospital_id, language) VALUES ('doctor', 'Dr. Ramesh Varma', '+919000000003', $1, $2, 'te') RETURNING id`,
    [newSosCode(), ids.kgh],
  );
  await query(`UPDATE doctors SET user_id = $1 WHERE id = $2`, [doctorUser.id, ramesh.id]);

  // A video consult for the demo patient with Dr. Ramesh on his next free slot,
  // so the call can be tried straight away from both logins.
  await query(
    `WITH s AS (
       UPDATE doctor_slots SET is_booked = true
        WHERE id = (SELECT id FROM doctor_slots WHERE doctor_id = $2 AND NOT is_booked AND starts_at > now() ORDER BY starts_at LIMIT 1)
        RETURNING id, starts_at)
     INSERT INTO appointments (patient_id, doctor_id, hospital_id, slot_id, starts_at, visit_type, status, token, room, chief_complaint)
     SELECT $1, $2, $3, s.id, s.starts_at, 'video', 'confirmed', 'B-1', '202', 'Sugar check and BP review' FROM s`,
    [p, ramesh.id, ids.kgh],
  );

  // ASHA health worker (mobile OTP 9000000004) with two villagers she registered.
  const asha = await one(
    `INSERT INTO users (role, full_name, phone, sos_code, language, village, lat, lng)
     VALUES ('health_worker', 'Sunitha K. (ASHA, Pedagantyada)', '+919000000004', $1, 'te', 'Pedagantyada', 17.6602, 83.2011) RETURNING id`,
    [newSosCode()],
  );
  const villagers = [
    ['Appalamma', 'female', '1954-01-01', null, 'Pedagantyada', 'Satyam (son)', '+919123400002'],
    ['Ramu Naidu', 'male', '1980-01-01', '+919123400001', 'Pedagantyada', 'Lakshmi (wife)', '+919123400003'],
  ];
  for (const [name, gender, dob, phone, village, cName, cPhone] of villagers) {
    const v = await one(
      `INSERT INTO users (role, full_name, gender, date_of_birth, phone, village, language, emergency_contact_name, emergency_contact_phone,
                          registered_by, sos_code, records_consent_at, lat, lng)
       VALUES ('patient', $1, $2, $3, $4, $5, 'te', $6, $7, $8, $9, now(), 17.6602, 83.2011) RETURNING id`,
      [name, gender, dob, phone, village, cName, cPhone, asha.id, newSosCode()],
    );
    await query(
      `INSERT INTO vitals (patient_id, recorded_by, recorded_at, systolic, diastolic, pulse, sugar_mgdl, sugar_type, weight_kg)
       VALUES ($1, $2, now() - interval '14 days', $3, $4, 78, $5, 'fasting', $6),
              ($1, $2, now() - interval '2 days', $7, $8, 82, $9, 'fasting', $6)`,
      name === 'Appalamma' ? [v.id, asha.id, 150, 94, 118, 48, 162, 98, 124] : [v.id, asha.id, 128, 82, 96, 71, 124, 80, 101],
    );
    if (name === 'Appalamma') {
      await query(`INSERT INTO health_conditions (patient_id, kind, name, status) VALUES ($1, 'condition', 'Hypertension', 'ongoing')`, [v.id]);
      await query(
        `INSERT INTO medications (patient_id, name, dose, times, instructions, start_date, end_date) VALUES ($1, 'Amlodipine', '5 mg', ARRAY['08:00'], 'After breakfast', current_date - 10, current_date + 80)`,
        [v.id],
      );
    }
  }

  // Stock photos for three demo doctors (see client/public/img/CREDITS.md); the rest show initials.
  for (const [name, photo] of [['Dr. Ramesh Varma', 'doctor-1.jpg'], ['Dr. Kavya Reddy', 'doctor-2.jpg'], ['Dr. Arjun Naidu', 'doctor-3.jpg']]) {
    await query(`UPDATE doctors SET photo_url = $2 WHERE full_name = $1`, [name, `/img/${photo}`]);
  }

  const { rows: [{ slots }] } = await query(`SELECT count(*)::int AS slots FROM doctor_slots`);
  return { hospitals: HOSPITALS.length, doctors: DOCTORS.length, slots, ambulances: AMBULANCES.length };
}

/**
 * Demo OPD slots for the next 7 days (Sunday closed), India time, ~20% pre-booked.
 * Runs at seed time and daily on demo/staging servers so booking never runs dry;
 * existing slots are left alone. Never used in production.
 */
export async function topUpDemoSlots() {
  const { rowCount } = await query(`
    INSERT INTO doctor_slots (doctor_id, starts_at, duration_min, is_booked)
    SELECT d.id, (day::date + t) AT TIME ZONE 'Asia/Kolkata', 30, random() < 0.2
      FROM doctors d,
           generate_series((now() AT TIME ZONE 'Asia/Kolkata')::date, (now() AT TIME ZONE 'Asia/Kolkata')::date + 7, interval '1 day') AS day,
           unnest(ARRAY['09:00','09:30','10:00','10:30','11:00','11:30','12:00','12:30','14:00','14:30','15:00','15:30','16:00','16:30']::time[]) AS t
     WHERE d.is_active
       AND extract(dow FROM day) <> 0
       AND (day::date + t) AT TIME ZONE 'Asia/Kolkata' > now()
    ON CONFLICT (doctor_id, starts_at) DO NOTHING`);
  return rowCount;
}
