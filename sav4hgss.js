// HGSS save file parser
// HeartGold / SoulSilver — Generation IV
// Reference: PKHeX SAV4HGSS.cs + SAV4.cs

import { decodePK4 } from './pk4.js';

const GENERAL_SIZE   = 0xF628;
const STORAGE_SIZE   = 0x12310;
const GENERAL_OFFSET = 0x00000;
const STORAGE_OFFSET = 0x0F700;

// Trainer1 block starts at 0x64 in General. All trainer fields are relative to this.
const TRAINER1_OFFSET = 0x64;
// Offsets relative to Trainer1
const T1_NAME    = 0x00; // 8 chars × 2 bytes = 16 bytes
const T1_TID     = 0x10; // uint16
const T1_SID     = 0x12; // uint16
const T1_MONEY   = 0x14; // uint32
const T1_GENDER  = 0x18; // uint8  0=male 1=female
const T1_LANG    = 0x19; // uint8
const T1_BADGES  = 0x1A; // uint8  Johto badges bitmask
const T1_KBADGES = 0x1F; // uint8  Kanto badges bitmask (at T1+0x1F per PKHeX)
const T1_HOURS   = 0x22; // uint16
const T1_MINUTES = 0x24; // uint8
const T1_SECONDS = 0x25; // uint8

// AdventureInfo = 0 in General block; SecondsToStart at +0x34
const SECONDS_TO_START = 0x34;

// Rival name in General block
const RIVAL_NAME_OFFSET = 0x22D4;

const PARTY_OFFSET = 0x0098;
const PARTY_SLOTS  = 6;
const PARTY_SIZE   = 236;

const BOX_COUNT  = 18;
const BOX_SLOTS  = 30;
const BOX_SIZE   = 136;
const BOX_STRIDE = 0x1000; // 30 slots × 136 = 0xFF0, padded to 0x1000

const JOHTO_BADGES = ['Zephyr','Hive','Plain','Fog','Storm','Mineral','Glacier','Rising'];
const KANTO_BADGES = ['Boulder','Cascade','Thunder','Rainbow','Soul','Marsh','Volcano','Earth'];

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

function getSaveCounter(buf, blockOffset, blockSize) {
  const view = new DataView(buf);
  return view.getUint32(blockOffset + blockSize - 0x10, true);
}

function stripDsvHeader(buf) {
  if (buf.byteLength === 0x80200) return buf.slice(512);
  return buf;
}

function parseTrainer(general, generalBase) {
  const view = new DataView(general.buffer, general.byteOffset, general.byteLength);
  const t1 = TRAINER1_OFFSET;

  // Decode Gen4 string from general block
  function str(off, maxChars) {
    return _decodeGen4Str(general, off, maxChars);
  }

  const tid  = view.getUint16(t1 + T1_TID, true);
  const sid  = view.getUint16(t1 + T1_SID, true);

  const johto = JOHTO_BADGES.filter((_, i) => (general[t1 + T1_BADGES]  >> i) & 1);
  const kanto = KANTO_BADGES.filter((_, i) => (general[t1 + T1_KBADGES] >> i) & 1);

  // Adventure start: seconds since 2000-01-01 (NDS epoch)
  const secs = view.getUint32(SECONDS_TO_START, true);
  const epoch2000 = Date.UTC(2000, 0, 1);
  const adventureStart = new Date(epoch2000 + secs * 1000);

  return {
    name:    str(t1 + T1_NAME, 8),
    tid,
    sid,
    money:   view.getUint32(t1 + T1_MONEY, true),
    gender:  general[t1 + T1_GENDER] === 0 ? 'Male' : 'Female',
    language: general[t1 + T1_LANG],
    badges:  { johto, kanto },
    playtime: {
      hours:   view.getUint16(t1 + T1_HOURS, true),
      minutes: general[t1 + T1_MINUTES],
      seconds: general[t1 + T1_SECONDS],
    },
    adventureStart,
    rivalName: str(RIVAL_NAME_OFFSET, 10),
  };
}

// Gen4 character table (same as pk4.js — duplicated here to keep this module self-contained)
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

export function parseHGSS(buffer) {
  const raw = stripDsvHeader(buffer);
  const u8  = new Uint8Array(raw);

  if (u8.length < STORAGE_OFFSET + STORAGE_SIZE) {
    throw new Error(`Save file too small: got 0x${u8.length.toString(16)}`);
  }

  const BACKUP_GENERAL = 0x40000;
  const BACKUP_STORAGE = 0x4F700;

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

  const genCrc = crc16(general, 0, GENERAL_SIZE - 0x10);
  const genStoredCrc = new DataView(raw).getUint16(generalOff + GENERAL_SIZE - 2, true);
  if (genCrc !== genStoredCrc) {
    console.warn(`General CRC mismatch: computed 0x${genCrc.toString(16)} vs stored 0x${genStoredCrc.toString(16)}`);
  }

  const trainer = parseTrainer(general, generalOff);
  const trainerTID = trainer.tid;

  // --- Parse party ---
  // Only include slots where TID matches trainer and EXP is plausible.
  // Unoccupied slots in Gen4 contain uninitialized data that can pass checksum by coincidence.
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

  // --- Parse PC boxes ---
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

  return {
    game: 'HGSS',
    trainer,
    party,
    boxes,
    totalPokemon: party.length + boxes.flat().length,
  };
}
