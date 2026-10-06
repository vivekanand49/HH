import { test } from 'node:test';
import assert from 'node:assert/strict';
import { triage, offlineAdvice } from './triage.js';
import { encodeSosSms, parseSosSms } from './sms.js';
import { chatReply, departmentFromText, dayFromText } from './chat.js';

test('triage detects critical combos in several languages', () => {
  assert.equal(triage('chest pain and hard to breathe').severity, 'critical');
  assert.equal(triage('నాకు ఛాతీ నొప్పి ఉంది').severity, 'critical');
  assert.equal(triage('सांस नहीं आ रही').severity, 'high');
  assert.equal(triage('मला ताप आहे').severity, 'low');
  assert.equal(triage('hello').severity, null);
  assert.equal(triage(['PREG', 'BLEED']).severity, 'critical');
});

test('offline advice falls back to English', () => {
  assert.match(offlineAdvice('critical', 'xx'), /108/);
});

test('SOS SMS round-trips and fits in one SMS', () => {
  const body = encodeSosSms({ sosCode: 'LD4821', lat: 17.69123, lng: 83.21784, codes: ['CHEST', 'BREATH'], severity: 'critical' });
  assert.equal(body, 'SOS PLD4821 LOC17.6912,83.2178 CHEST,BREATH SEV4');
  assert.ok(body.length <= 160);
  assert.deepEqual(parseSosSms(body), { sosCode: 'LD4821', lat: 17.6912, lng: 83.2178, codes: ['CHEST', 'BREATH'], severity: 'critical' });
  assert.equal(parseSosSms('hello'), null);
  assert.deepEqual(parseSosSms('sos').codes, []);
});

test('chat asks follow-up questions, then offers booking in the right department', () => {
  const m = [{ role: 'user', content: 'I have fever' }];
  const talk = (text) => {
    if (text) m.push({ role: 'user', content: text });
    const r = chatReply(m, 'en');
    m.push({ role: 'assistant', content: r.reply });
    return r;
  };
  assert.equal(talk().quickReplies.length, 3); // since when?
  assert.equal(talk('More than a week').quickReplies.length, 3); // how bad?
  const done = talk('Mild');
  assert.equal(done.book, true);
  assert.equal(done.department, 'general');
  assert.equal(done.severity, 'medium'); // more than a week: see a doctor
  assert.match(done.reply, /paracetamol/);
  assert.equal(chatReply([{ role: 'user', content: 'chest pain' }], 'te').severity, 'critical');
  assert.equal(chatReply([{ role: 'user', content: 'book a doctor for my sugar' }]).department, 'diabetes');
  assert.equal(departmentFromText('నా బిడ్డకు జ్వరం'), 'pediatrics');
  assert.equal(departmentFromText('a person with a reason'), null);
  assert.equal(dayFromText('doctor tomorrow please'), 'tomorrow');
});
