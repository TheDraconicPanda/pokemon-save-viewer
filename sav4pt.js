// Platinum save file parser — Generation IV
// Reference: PKHeX SAV4Pt.cs + Bulbapedia Gen IV save structure

import { decodePK4 } from './pk4.js';

const GENERAL_SIZE  = 0xC0EC;
const STORAGE_SIZE  = 0x121E4;
const GENERAL_OFFSET = 0x00000;
const STORAGE_OFFSET = 0x0C100;

const PARTY_OFFSET  = 0x00A0;
const PARTY_SLOTS   = 6;
const PARTY_SIZE    = 236;

const BOX_COUNT     = 18;
const BOX_SLOTS     = 30;
const BOX_SIZE      = 136;

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
  return view.getUint32(blockOffset + blockSize - 0x10 + 0x0C, true);
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

  const party = [];
  for (let i = 0; i < PARTY_SLOTS; i++) {
    const offset = PARTY_OFFSET + i * PARTY_SIZE;
    const slot = general.slice(offset, offset + PARTY_SIZE);
    const mon = decodePK4(slot);
    if (mon) { mon.partySlot = i; mon.inParty = true; party.push(mon); }
  }

  const boxes = [];
  for (let box = 0; box < BOX_COUNT; box++) {
    const mons = [];
    for (let slot = 0; slot < BOX_SLOTS; slot++) {
      const offset = (box * BOX_SLOTS + slot) * BOX_SIZE;
      const data = storage.slice(offset, offset + BOX_SIZE);
      const mon = decodePK4(data);
      if (mon) { mon.boxIndex = box; mon.boxSlot = slot; mon.inParty = false; mons.push(mon); }
    }
    boxes.push(mons);
  }

  return { game: 'Platinum', party, boxes, totalPokemon: party.length + boxes.flat().length };
}
