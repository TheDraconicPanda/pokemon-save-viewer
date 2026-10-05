// HGSS save file parser
// HeartGold / SoulSilver — Generation IV
// Reference: PKHeX SAV4HGSS.cs + Bulbapedia Gen IV save structure

import { decodePK4 } from './pk4.js';

// Save file constants
const GENERAL_SIZE  = 0xF628;
const STORAGE_SIZE  = 0x12310;
const GENERAL_OFFSET = 0x00000;
const STORAGE_OFFSET = 0x0F700;

// HGSS General block offsets
const PARTY_OFFSET  = 0x0098;
const PARTY_SLOTS   = 6;
const PARTY_SIZE    = 236; // party Pokemon include battle stats

// HGSS Storage block offsets
const BOX_COUNT     = 18;
const BOX_SLOTS     = 30;
const BOX_SIZE      = 136; // boxed Pokemon
const BOX_STRIDE    = 0x1000; // each box padded to 0x1000

// CRC-16-CCITT (XModem variant, poly 0x1021, init 0x0000)
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

// Read the save counter from the block footer (last 20 bytes of each block)
function getSaveCounter(buf, blockOffset, blockSize) {
  const view = new DataView(buf);
  const footerStart = blockOffset + blockSize - 20;
  return view.getUint32(footerStart + 12, true);
}

// Determine if a DeSmuME .dsv header is present (512-byte header before raw save data)
function stripDsvHeader(buf) {
  if (buf.byteLength === 0x80200) {
    // DeSmuME adds a 512-byte header; the actual save data starts at byte 512
    return buf.slice(512);
  }
  // Some emulators use 0x80000 raw saves — no header
  return buf;
}

/**
 * Parse an HGSS save file buffer.
 * @param {ArrayBuffer} buffer - raw .sav or .dsv file
 * @returns {{ game: string, party: object[], boxes: object[][] }} parsed data
 */
export function parseHGSS(buffer) {
  const raw = stripDsvHeader(buffer);
  const u8  = new Uint8Array(raw);

  if (u8.length < STORAGE_OFFSET + STORAGE_SIZE) {
    throw new Error(`Save file too small: expected at least ${(STORAGE_OFFSET + STORAGE_SIZE).toString(16)} bytes, got ${u8.length.toString(16)}`);
  }

  // Pick the more recent save block pair using save counters
  // Primary: blocks at the offsets above
  // Backup: at 0x40000 + same offsets (not present in all dumps; skip if absent)
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

  // Extract blocks
  const general = u8.subarray(generalOff, generalOff + GENERAL_SIZE);
  const storage = u8.subarray(storageOff, storageOff + STORAGE_SIZE);

  // Verify checksums (warn but don't abort — emulator saves sometimes have different layouts)
  const genCrc = crc16(general, 0, GENERAL_SIZE - 20);
  const genStoredCrc = new DataView(raw).getUint16(generalOff + GENERAL_SIZE - 2, true);
  if (genCrc !== genStoredCrc) {
    console.warn(`General block CRC mismatch: computed 0x${genCrc.toString(16).toUpperCase()} vs stored 0x${genStoredCrc.toString(16).toUpperCase()}`);
  }

  // --- Parse party ---
  const party = [];
  for (let i = 0; i < PARTY_SLOTS; i++) {
    const offset = PARTY_OFFSET + i * PARTY_SIZE;
    const slot = general.slice(offset, offset + PARTY_SIZE);
    const mon = decodePK4(slot);
    if (mon) {
      mon.partySlot = i;
      mon.inParty = true;
      party.push(mon);
    }
  }

  // --- Parse PC boxes ---
  const boxes = [];
  for (let box = 0; box < BOX_COUNT; box++) {
    const mons = [];
    for (let slot = 0; slot < BOX_SLOTS; slot++) {
      const offset = box * BOX_STRIDE + slot * BOX_SIZE;
      const data = storage.slice(offset, offset + BOX_SIZE);
      const mon = decodePK4(data);
      if (mon) {
        mon.boxIndex = box;
        mon.boxSlot  = slot;
        mon.inParty  = false;
        mons.push(mon);
      }
    }
    boxes.push(mons);
  }

  return {
    game: 'HGSS',
    party,
    boxes,
    totalPokemon: party.length + boxes.flat().length,
  };
}
