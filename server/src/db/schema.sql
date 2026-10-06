-- Swasthya Setu schema (PostgreSQL 14+; also runs on PGlite).
-- Fixes from the original plan:
--  * CHECK constraints instead of MySQL-style inline ENUM
--  * Aadhaar is never stored: only a keyed HMAC for lookup + last 4 digits
--  * one users table with roles (patient, staff, doctor, dispatcher, admin)
--  * doctor_slots with a UNIQUE booking per slot, so double booking is impossible
--  * updated_at maintained by a trigger
--  * emergency_alerts.client_ref makes offline retries idempotent

CREATE OR REPLACE FUNCTION touch_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TABLE IF NOT EXISTS hospitals (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name             text NOT NULL,
  type             text NOT NULL CHECK (type IN ('government', 'private')),
  address          text NOT NULL,
  area             text,
  city             text NOT NULL DEFAULT 'Visakhapatnam',
  district         text NOT NULL DEFAULT 'Visakhapatnam',
  state            text NOT NULL DEFAULT 'Andhra Pradesh',
  pincode          text,
  lat              double precision NOT NULL,
  lng              double precision NOT NULL,
  phone            text,
  emergency_phone  text,
  sms_number       text,
  departments      text[] NOT NULL DEFAULT '{}',
  has_emergency    boolean NOT NULL DEFAULT false,
  beds_free        integer NOT NULL DEFAULT 0,
  er_beds_free     integer NOT NULL DEFAULT 0,
  is_active        boolean NOT NULL DEFAULT true,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS users (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  role                     text NOT NULL DEFAULT 'patient'
                           CHECK (role IN ('patient', 'health_worker', 'doctor', 'hospital_staff', 'dispatcher', 'admin')),
  full_name                text,
  phone                    text UNIQUE,
  aadhaar_hash             text UNIQUE,
  aadhaar_last4            text,
  abha_number              text UNIQUE,
  sos_code                 text UNIQUE NOT NULL,
  date_of_birth            date,
  gender                   text CHECK (gender IN ('female', 'male', 'other')),
  blood_group              text,
  language                 text NOT NULL DEFAULT 'en' CHECK (language IN ('en', 'te', 'hi', 'mr')),
  address                  text,
  lat                      double precision,
  lng                      double precision,
  location_updated_at      timestamptz,
  hospital_id              uuid REFERENCES hospitals(id),
  emergency_contact_name   text,
  emergency_contact_phone  text,
  records_consent_at       timestamptz,
  is_active                boolean NOT NULL DEFAULT true,
  last_login_at            timestamptz,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS otp_requests (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code_hash    text NOT NULL,
  expires_at   timestamptz NOT NULL,
  attempts     integer NOT NULL DEFAULT 0,
  consumed_at  timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS doctors (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           uuid REFERENCES users(id),
  hospital_id       uuid NOT NULL REFERENCES hospitals(id),
  full_name         text NOT NULL,
  department        text NOT NULL,
  qualifications    text[] NOT NULL DEFAULT '{}',
  experience_years  integer,
  languages         text[] NOT NULL DEFAULT '{}',
  fee_inr           integer NOT NULL DEFAULT 0,
  video_fee_inr     integer,
  opd_block         text NOT NULL DEFAULT 'A',
  room              text,
  rating            numeric(2,1),
  is_active         boolean NOT NULL DEFAULT true,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS doctor_slots (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  doctor_id     uuid NOT NULL REFERENCES doctors(id) ON DELETE CASCADE,
  starts_at     timestamptz NOT NULL,
  duration_min  integer NOT NULL DEFAULT 15,
  is_booked     boolean NOT NULL DEFAULT false,
  UNIQUE (doctor_id, starts_at)
);

CREATE TABLE IF NOT EXISTS appointments (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id       uuid NOT NULL REFERENCES users(id),
  doctor_id        uuid NOT NULL REFERENCES doctors(id),
  hospital_id      uuid NOT NULL REFERENCES hospitals(id),
  slot_id          uuid REFERENCES doctor_slots(id),
  starts_at        timestamptz NOT NULL,
  visit_type       text NOT NULL DEFAULT 'in_person' CHECK (visit_type IN ('in_person', 'video', 'home_visit')),
  status           text NOT NULL DEFAULT 'confirmed'
                   CHECK (status IN ('pending_payment', 'confirmed', 'completed', 'cancelled', 'no_show')),
  token            text,
  room             text,
  fee_inr          integer NOT NULL DEFAULT 0,
  payment_status   text NOT NULL DEFAULT 'not_required'
                   CHECK (payment_status IN ('not_required', 'pending', 'paid', 'refunded')),
  chief_complaint  text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
-- A slot can hold only one live booking; cancelled bookings release it.
CREATE UNIQUE INDEX IF NOT EXISTS appointments_slot_live
  ON appointments(slot_id) WHERE status <> 'cancelled';

CREATE TABLE IF NOT EXISTS medical_records (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id   uuid NOT NULL REFERENCES users(id),
  hospital_id  uuid REFERENCES hospitals(id),
  doctor_id    uuid REFERENCES doctors(id),
  kind         text NOT NULL CHECK (kind IN ('lab', 'prescription', 'imaging', 'discharge', 'vaccination', 'other')),
  title        text NOT NULL,
  summary      text,
  file_key     text,
  recorded_on  date NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS medications (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id  uuid NOT NULL REFERENCES users(id),
  record_id   uuid REFERENCES medical_records(id),
  name        text NOT NULL,
  dose        text,
  times       text[] NOT NULL DEFAULT '{}',
  instructions text,
  start_date  date,
  end_date    date,
  is_active   boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS health_conditions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id  uuid NOT NULL REFERENCES users(id),
  kind        text NOT NULL DEFAULT 'condition' CHECK (kind IN ('condition', 'allergy')),
  name        text NOT NULL,
  status      text NOT NULL DEFAULT 'ongoing' CHECK (status IN ('ongoing', 'monitoring', 'resolved')),
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ambulances (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  registration   text UNIQUE NOT NULL,
  hospital_id    uuid REFERENCES hospitals(id),
  driver_name    text,
  driver_phone   text,
  lat            double precision,
  lng            double precision,
  status         text NOT NULL DEFAULT 'free' CHECK (status IN ('free', 'busy', 'offline')),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS emergency_alerts (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_ref           text UNIQUE,
  patient_id           uuid REFERENCES users(id),
  phone                text,
  channel              text NOT NULL CHECK (channel IN ('app', 'sms', 'missed_call', 'voice', 'staff')),
  severity             text NOT NULL CHECK (severity IN ('unknown', 'low', 'medium', 'high', 'critical')),
  symptoms             text[] NOT NULL DEFAULT '{}',
  note                 text,
  raw_message          text,
  lat                  double precision,
  lng                  double precision,
  location_accuracy_m  integer,
  location_source      text CHECK (location_source IN ('gps', 'sms', 'last_known', 'none')),
  hospital_id          uuid REFERENCES hospitals(id),
  ambulance_id         uuid REFERENCES ambulances(id),
  status               text NOT NULL DEFAULT 'new'
                       CHECK (status IN ('new', 'acknowledged', 'dispatched', 'resolved', 'cancelled')),
  acknowledged_by      uuid REFERENCES users(id),
  acknowledged_at      timestamptz,
  dispatched_at        timestamptz,
  resolved_at          timestamptz,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ai_conversations (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id  uuid REFERENCES users(id),
  language    text NOT NULL DEFAULT 'en',
  messages    jsonb NOT NULL DEFAULT '[]',
  severity    text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sms_log (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  direction   text NOT NULL CHECK (direction IN ('in', 'out')),
  phone       text NOT NULL,
  body        text NOT NULL,
  provider    text,
  status      text,
  alert_id    uuid REFERENCES emergency_alerts(id),
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS audit_log (
  id          bigserial PRIMARY KEY,
  actor_id    uuid,
  action      text NOT NULL,
  entity      text NOT NULL,
  entity_id   text,
  meta        jsonb,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- ---- Step 3: files, payments, consult notes ----
CREATE TABLE IF NOT EXISTS files (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id     uuid REFERENCES users(id),
  kind         text NOT NULL CHECK (kind IN ('record', 'voice')),
  storage      text NOT NULL CHECK (storage IN ('local', 's3')),
  storage_key  text NOT NULL UNIQUE,
  mime         text NOT NULL,
  size_bytes   integer NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE medical_records ADD COLUMN IF NOT EXISTS file_id uuid REFERENCES files(id);
ALTER TABLE medical_records ADD COLUMN IF NOT EXISTS uploaded_by uuid REFERENCES users(id);
ALTER TABLE emergency_alerts ADD COLUMN IF NOT EXISTS voice_file_id uuid REFERENCES files(id);
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS diagnosis text;
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS completed_at timestamptz;

CREATE TABLE IF NOT EXISTS payments (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  appointment_id  uuid NOT NULL REFERENCES appointments(id),
  patient_id      uuid NOT NULL REFERENCES users(id),
  provider        text NOT NULL CHECK (provider IN ('razorpay', 'mock')),
  order_id        text NOT NULL UNIQUE,
  payment_id      text,
  amount_inr      integer NOT NULL,
  status          text NOT NULL DEFAULT 'created' CHECK (status IN ('created', 'paid', 'failed')),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS payments_appointment ON payments(appointment_id);

-- ---- Step 4: reminders, ASHA health workers, voice transcripts, security ----
ALTER TABLE users ADD COLUMN IF NOT EXISTS token_version integer NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS reminders_enabled boolean NOT NULL DEFAULT true;
ALTER TABLE users ADD COLUMN IF NOT EXISTS reminder_sms boolean NOT NULL DEFAULT false;
ALTER TABLE users ADD COLUMN IF NOT EXISTS registered_by uuid REFERENCES users(id);
ALTER TABLE users ADD COLUMN IF NOT EXISTS village text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS client_ref text UNIQUE;

CREATE TABLE IF NOT EXISTS push_subscriptions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  endpoint    text NOT NULL UNIQUE,
  p256dh      text NOT NULL,
  auth        text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- One reminder per dose: the unique key stops duplicates if the job runs twice.
CREATE TABLE IF NOT EXISTS reminder_log (
  id             bigserial PRIMARY KEY,
  medication_id  uuid NOT NULL REFERENCES medications(id) ON DELETE CASCADE,
  dose_date      date NOT NULL,
  dose_time      text NOT NULL,
  channels       text[] NOT NULL DEFAULT '{}',
  sent_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (medication_id, dose_date, dose_time)
);

CREATE TABLE IF NOT EXISTS vitals (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_ref     text UNIQUE,
  patient_id     uuid NOT NULL REFERENCES users(id),
  recorded_by    uuid REFERENCES users(id),
  recorded_at    timestamptz NOT NULL DEFAULT now(),
  systolic       integer CHECK (systolic BETWEEN 50 AND 300),
  diastolic      integer CHECK (diastolic BETWEEN 30 AND 200),
  pulse          integer CHECK (pulse BETWEEN 20 AND 250),
  sugar_mgdl     integer CHECK (sugar_mgdl BETWEEN 20 AND 800),
  sugar_type     text CHECK (sugar_type IN ('fasting', 'random', 'after_meal')),
  temperature_f  numeric(4,1) CHECK (temperature_f BETWEEN 90 AND 110),
  weight_kg      numeric(5,1) CHECK (weight_kg BETWEEN 1 AND 300),
  spo2           integer CHECK (spo2 BETWEEN 50 AND 100),
  notes          text
);
CREATE INDEX IF NOT EXISTS vitals_patient ON vitals(patient_id, recorded_at DESC);
CREATE INDEX IF NOT EXISTS users_registered_by ON users(registered_by);

ALTER TABLE emergency_alerts ADD COLUMN IF NOT EXISTS voice_language text;
ALTER TABLE emergency_alerts ADD COLUMN IF NOT EXISTS voice_transcript text;
ALTER TABLE emergency_alerts ADD COLUMN IF NOT EXISTS voice_transcript_en text;
ALTER TABLE emergency_alerts ADD COLUMN IF NOT EXISTS raised_by uuid REFERENCES users(id);

CREATE INDEX IF NOT EXISTS doctors_hospital_dept ON doctors(hospital_id, department);
CREATE INDEX IF NOT EXISTS slots_doctor_time ON doctor_slots(doctor_id, starts_at);
CREATE INDEX IF NOT EXISTS appointments_patient ON appointments(patient_id, starts_at);
CREATE INDEX IF NOT EXISTS records_patient ON medical_records(patient_id, recorded_on DESC);
CREATE INDEX IF NOT EXISTS alerts_open ON emergency_alerts(hospital_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS audit_entity ON audit_log(entity, entity_id);

-- The audit log is append-only: nobody (not even the app) can edit or delete it.
CREATE OR REPLACE FUNCTION audit_log_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit_log is append-only';
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS audit_log_no_change ON audit_log;
CREATE TRIGGER audit_log_no_change BEFORE UPDATE OR DELETE ON audit_log FOR EACH ROW EXECUTE FUNCTION audit_log_append_only();

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['hospitals', 'users', 'doctors', 'appointments', 'emergency_alerts', 'ai_conversations', 'payments']
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I_touch ON %I', t, t);
    EXECUTE format('CREATE TRIGGER %I_touch BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION touch_updated_at()', t, t);
  END LOOP;
END $$;

-- ---- Step 5: hospital admin portal ----
-- hospital_admin runs one hospital (users.hospital_id); admin is the district admin (all hospitals).
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check
  CHECK (role IN ('patient', 'health_worker', 'doctor', 'hospital_staff', 'hospital_admin', 'dispatcher', 'admin'));
ALTER TABLE hospitals ADD COLUMN IF NOT EXISTS beds_total integer CHECK (beds_total >= 0);
ALTER TABLE hospitals ADD COLUMN IF NOT EXISTS er_beds_total integer CHECK (er_beds_total >= 0);
ALTER TABLE hospitals ADD COLUMN IF NOT EXISTS beds_updated_at timestamptz;
-- Set when the hospital cancels (doctor on leave). refund_due marks paid visits the hospital must refund.
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS cancel_reason text;
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS refund_due boolean NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS users_hospital_role ON users(hospital_id, role);
-- Public path of the doctor's photo shown when patients book (demo: stock photos in client/public/img).
ALTER TABLE doctors ADD COLUMN IF NOT EXISTS photo_url text;

-- ---- Step 5: family accounts ----
-- A guardian (one phone) manages health profiles for family members: children
-- and elderly parents with no smartphone. Members with their own phone agree by
-- OTP before they are linked. A member can have more than one guardian.
CREATE TABLE IF NOT EXISTS family_links (
  guardian_id  uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  member_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  relation     text NOT NULL CHECK (relation IN ('spouse', 'child', 'parent', 'sibling', 'grandparent', 'grandchild', 'other')),
  created_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (guardian_id, member_id),
  CHECK (guardian_id <> member_id)
);
CREATE INDEX IF NOT EXISTS family_links_member ON family_links(member_id);
-- An OTP can now also be the member's "yes" to being linked (purpose = 'family_link').
ALTER TABLE otp_requests ADD COLUMN IF NOT EXISTS purpose text NOT NULL DEFAULT 'login' CHECK (purpose IN ('login', 'family_link'));
ALTER TABLE otp_requests ADD COLUMN IF NOT EXISTS meta jsonb;

-- ---- Offline payment: pay at the hospital counter ----
-- 'at_counter': the patient chose to pay cash/UPI at the counter on arrival; the
-- visit is confirmed, and the hospital marks it 'paid' when the money is collected.
ALTER TABLE appointments DROP CONSTRAINT IF EXISTS appointments_payment_status_check;
ALTER TABLE appointments ADD CONSTRAINT appointments_payment_status_check
  CHECK (payment_status IN ('not_required', 'pending', 'at_counter', 'paid', 'refunded'));
ALTER TABLE sms_log ADD COLUMN IF NOT EXISTS template text;
ALTER TABLE sms_log ADD COLUMN IF NOT EXISTS provider_id text;
