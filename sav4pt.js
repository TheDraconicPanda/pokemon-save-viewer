// Platinum save file parser — Generation IV
// Reference: PKHeX SAV4Pt.cs + SAV4.cs

import { decodePK4 } from './pk4.js';

const GENERAL_SIZE   = 0xC0EC;
const STORAGE_SIZE   = 0x121E4;
const GENERAL_OFFSET = 0x00000;
const STORAGE_OFFSET = 0x0C100;

// Trainer1 block and field offsets (same layout as HGSS)
const TRAINER1_OFFSET = 0x64;
const T1_NAME    = 0x00;
const T1_TID     = 0x10;
const T1_SID     = 0x12;
const T1_MONEY   = 0x14;
const T1_GENDER  = 0x18;
const T1_LANG    = 0x19;
const T1_BADGES  = 0x1A; // Sinnoh badges bitmask
const T1_HOURS   = 0x22;
const T1_MINUTES = 0x24;
const T1_SECONDS = 0x25;

const SECONDS_TO_START = 0x34;

const PARTY_OFFSET = 0x00A0;
const PARTY_SLOTS  = 6;
const PARTY_SIZE   = 236;

const BOX_COUNT  = 18;
const BOX_SLOTS  = 30;
const BOX_SIZE   = 136;
const BOX_STRIDE = 0x1000;

const SINNOH_BADGES = ['Coal','Forest','Cobble','Fen','Relic','Mine','Icicle','Beacon'];

function crc16(data, offset, length) {
  let crc = 0;
  for (let i = offset; i < offset + length; i++) {
    crc ^= data[i] << 8;
    for (let j = 0; j < 8; j++) {
      crc = (crc & 0x8000) ? ((crc << 1) ^ 0x1021) : (crc << 1);
      crc &= 0xFFFF;
    }
  }
  return crc;
}

function stripDsvHeader(buf) {
  if (buf.byteLength === 0x80200) return buf.slice(512);
  return buf;
}

function getSaveCounter(buf, blockOffset, blockSize) {
  const view = new DataView(buf);
  return view.getUint32(blockOffset + blockSize - 0x10, true);
}

const GEN4_CHARS =
  ' ÀÁÂÇÈÉÊËÎÏÔÙÛÜá' +
  'àâçèéêëîïôùûüñß°' +
  '♂♀$,×/():ÄÖ' +
  'ABCDEFGHIJKLMNOPQRSTUVWXYZ' +
  'abcdefghijklmnopqrstuvwxyz' +
  '0123456789!?.-·\'"' +
  '"…+&#|™←^⬆⬇⬅';

function _decodeGen4Str(data, offset, maxChars) {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let s = '';
  for (let i = 0; i < maxChars; i++) {
    const cp = view.getUint16(offset + i * 2, true);
    if (cp === 0xFFFF || cp === 0) break;
    if (cp >= 0x0100 && cp < 0x0200) {
      const idx = cp & 0xFF;
      s += idx < GEN4_CHARS.length ? GEN4_CHARS[idx] : '?';
    } else {
      s += '?';
    }
  }
  return s;
}

function parseTrainer(general) {
  const view = new DataView(general.buffer, general.byteOffset, general.byteLength);
  const t1 = TRAINER1_OFFSET;

  const sinnoh = SINNOH_BADGES.filter((_, i) => (general[t1 + T1_BADGES] >> i) & 1);

  const secs = view.getUint32(SECONDS_TO_START, true);
  const adventureStart = new Date(Date.UTC(2000, 0, 1) + secs * 1000);

  return {
    name:     _decodeGen4Str(general, t1 + T1_NAME, 8),
    tid:      view.getUint16(t1 + T1_TID, true),
    sid:      view.getUint16(t1 + T1_SID, true),
    money:    view.getUint32(t1 + T1_MONEY, true),
    gender:   general[t1 + T1_GENDER] === 0 ? 'Male' : 'Female',
    language: general[t1 + T1_LANG],
    badges:   { sinnoh },
    playtime: {
      hours:   view.getUint16(t1 + T1_HOURS, true),
      minutes: general[t1 + T1_MINUTES],
      seconds: general[t1 + T1_SECONDS],
    },
    adventureStart,
  };
}

export function parsePlatinum(buffer) {
  const raw = stripDsvHeader(buffer);
  const u8  = new Uint8Array(raw);

  const BACKUP_GENERAL = 0x40000;
  const BACKUP_STORAGE = 0x4C100;

  let generalOff = GENERAL_OFFSET;
  let storageOff = STORAGE_OFFSET;

  if (u8.length >= BACKUP_STORAGE + STORAGE_SIZE) {
    const primaryCounter = getSaveCounter(raw, GENERAL_OFFSET, GENERAL_SIZE);
    const backupCounter  = getSaveCounter(raw, BACKUP_GENERAL, GENERAL_SIZE);
    if (backupCounter > primaryCounter) {
      generalOff = BACKUP_GENERAL;
      storageOff = BACKUP_STORAGE;
    }
  }

  const general = u8.subarray(generalOff, generalOff + GENERAL_SIZE);
  const storage = u8.subarray(storageOff, storageOff + STORAGE_SIZE);

  const trainer = parseTrainer(general);
  const trainerTID = trainer.tid;

  const party = [];
  for (let i = 0; i < PARTY_SLOTS; i++) {
    const offset = PARTY_OFFSET + i * PARTY_SIZE;
    const slot = general.slice(offset, offset + PARTY_SIZE);
    const mon = decodePK4(slot);
    if (!mon) continue;
    if (mon.tid !== trainerTID || mon.exp >= 2_000_000) continue;
    mon.partySlot = i;
    mon.inParty = true;
    party.push(mon);
  }

  const boxes = [];
  for (let box = 0; box < BOX_COUNT; box++) {
    const mons = [];
    for (let slot = 0; slot < BOX_SLOTS; slot++) {
      const offset = box * BOX_STRIDE + slot * BOX_SIZE;
      const data = storage.slice(offset, offset + BOX_SIZE);
      const mon = decodePK4(data);
      if (!mon) continue;
      mon.boxIndex = box;
      mon.boxSlot  = slot;
      mon.inParty  = false;
      mons.push(mon);
    }
    boxes.push(mons);
  }

  return { game: 'Platinum', trainer, party, boxes, totalPokemon: party.length + boxes.flat().length };
}
