// PK4 — Generation IV Pokémon structure decoder
// Ported from PKHeX (kwsch/PKHeX) — MIT License

// The 24 possible block orderings for the ABCD shuffle.
// Each row is [blockA_idx, blockB_idx, blockC_idx, blockD_idx]
const BLOCK_POSITIONS = [
  [0, 1, 2, 3], [0, 1, 3, 2], [0, 2, 1, 3], [0, 3, 1, 2],
  [0, 2, 3, 1], [0, 3, 2, 1], [1, 0, 2, 3], [1, 0, 3, 2],
  [2, 0, 1, 3], [3, 0, 1, 2], [2, 0, 3, 1], [3, 0, 2, 1],
  [1, 2, 0, 3], [1, 3, 0, 2], [2, 1, 0, 3], [3, 1, 0, 2],
  [2, 3, 0, 1], [3, 2, 0, 1], [1, 2, 3, 0], [1, 3, 2, 0],
  [2, 1, 3, 0], [3, 1, 2, 0], [2, 3, 1, 0], [3, 2, 1, 0],
];

// Linear congruential PRNG used for encryption
function prngNext(seed) {
  // Use BigInt for correct 32-bit unsigned arithmetic
  return Number((BigInt(seed) * 0x41C64E6Dn + 0x6073n) & 0xFFFFFFFFn);
}

// Decrypt a 136-byte (boxed) or 236-byte (party) PK4 blob.
// Returns a new Uint8Array with the encrypted blocks decrypted in place.
function decryptPK4(data) {
  const out = new Uint8Array(data);
  const view = new DataView(out.buffer, out.byteOffset, out.byteLength);

  const pid = view.getUint32(0, true);
  const checksum = view.getUint16(6, true);

  // 1. XOR-decrypt all 128 bytes of encrypted data (0x08–0x87)
  // Must happen BEFORE unshuffling — the shuffle is applied to the decrypted blocks.
  let seed = checksum;
  for (let i = 0x08; i < 0x88; i += 2) {
    seed = prngNext(seed);
    const keyWord = (seed >>> 16) & 0xFFFF;
    view.setUint16(i, view.getUint16(i, true) ^ keyWord, true);
  }

  // 2. Unshuffle the four 32-byte blocks at 0x08–0x87
  const shift = ((pid & 0x3E000) >>> 13) % 24;
  const order = BLOCK_POSITIONS[shift];
  const blocks = [0, 1, 2, 3].map(i => out.slice(8 + i * 32, 8 + i * 32 + 32));
  for (let dest = 0; dest < 4; dest++) {
    const src = order.indexOf(dest);
    out.set(blocks[src], 8 + dest * 32);
  }

  // 3. Decrypt battle stats (0x88–0xEB) if party-sized (236 bytes)
  if (data.length > 136) {
    for (let i = 0x88; i < 0xEB; i += 2) {
      seed = prngNext(seed);
      view.setUint16(i, view.getUint16(i, true) ^ ((seed >>> 16) & 0xFFFF), true);
    }
  }

  return out;
}

// Gen 4 international character table (from PKHeX Char4b.cs)
// Maps byte index (code & 0xFF when high byte is 0x01) to Unicode character
const GEN4_CHARS =
  ' ÀÁÂÇÈÉÊËÎÏÔÙÛÜá' + // 00-0F
  'àâçèéêëîïôùûüñß°' + // 10-1F
  '♂♀$,×/ABCDEFGHIJ' + // 20-2F
  'KLMNOPQRSTUVWXYZ' + // 30-3F
  '():ÄÖabcdefghijk' + // 40-4F
  'lmnopqrstuvwxyz0' + // 50-5F
  '123456789!?.-·\'“' + // 60-6F
  '”…+&#|™←^⬆⬇⬅'; // 70-7B

// Decode a Gen 4 encoded Pokémon string (terminated by 0xFFFF)
function decodePk4String(data, offset, maxChars) {
  const view = new DataView(data.buffer ?? data);
  let s = '';
  for (let i = 0; i < maxChars; i++) {
    const cp = view.getUint16(offset + i * 2, true);
    if (cp === 0xFFFF || cp === 0x0000) break;
    if (cp >= 0x0100 && cp < 0x0200) {
      const idx = cp & 0xFF;
      s += idx < GEN4_CHARS.length ? GEN4_CHARS[idx] : '�';
    } else {
      // Value outside expected range — corrupted or non-Latin encoding
      s += '?';
    }
  }
  return s;
}

const NATURES = [
  'Hardy','Lonely','Brave','Adamant','Naughty',
  'Bold','Docile','Relaxed','Impish','Lax',
  'Timid','Hasty','Serious','Jolly','Naive',
  'Modest','Mild','Quiet','Bashful','Rash',
  'Calm','Gentle','Sassy','Careful','Quirky',
];

// Stat modifier from nature: +1.1, 1.0, or 0.9
// Order: ATK, DEF, SPE, SPA, SPD
const NATURE_MODS = [
  // Hardy Lonely Brave Adamant Naughty Bold   Docile Relaxed Impish Lax
  [0,0,0,0,0], [1,-1,0,0,0], [1,0,-1,0,0], [1,0,0,-1,0], [1,0,0,0,-1],
  // Timid  Hasty  Serious Jolly   Naive   Modest Mild   Quiet   Bashful Rash
  [-1,1,0,0,0], [0,-1,1,0,0], [0,0,0,0,0], [0,0,1,-1,0], [0,0,1,0,-1],
  // Calm   Gentle Sassy   Careful Quirky
  [-1,0,-1,1,0], [0,1,0,1,-1], [0,0,0,0,0], [0,0,-1,0,1], [0,-1,0,0,1],
  [0,0,0,1,-1], [0,1,0,-1,0], [0,0,-1,1,0], [0,0,0,0,0], [0,1,0,0,-1],
  [-1,0,0,1,0], [0,-1,0,1,0], [0,0,1,0,-1], [-1,0,0,0,1], [0,0,0,0,0],
];

// HP type lookup for Hidden Power
const HP_TYPES = [
  'Fighting','Flying','Poison','Ground','Rock','Bug',
  'Ghost','Steel','Fire','Water','Grass','Electric',
  'Psychic','Ice','Dragon','Dark',
];

/**
 * Parse a decrypted PK4 byte array and return a plain object with all fields.
 * @param {Uint8Array} raw - 136 (boxed) or 236 (party) bytes, already decrypted
 */
function parsePK4(raw) {
  const v = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);

  const pid   = v.getUint32(0x00, true);
  const tid   = v.getUint16(0x0C, true);
  const sid   = v.getUint16(0x0E, true);
  const exp   = v.getUint32(0x10, true);

  // Block A
  const species     = v.getUint16(0x08, true);
  const heldItem    = v.getUint16(0x0A, true);
  const friendship  = v.getUint8(0x14);
  const ability     = v.getUint8(0x15);
  const language    = v.getUint8(0x17);
  const evs = {
    hp:  v.getUint8(0x18),
    atk: v.getUint8(0x19),
    def: v.getUint8(0x1A),
    spe: v.getUint8(0x1B),
    spa: v.getUint8(0x1C),
    spd: v.getUint8(0x1D),
  };
  const evTotal = evs.hp + evs.atk + evs.def + evs.spe + evs.spa + evs.spd;

  // Block B
  const moves = [
    v.getUint16(0x28, true),
    v.getUint16(0x2A, true),
    v.getUint16(0x2C, true),
    v.getUint16(0x2E, true),
  ];
  const pp = [
    v.getUint8(0x30),
    v.getUint8(0x31),
    v.getUint8(0x32),
    v.getUint8(0x33),
  ];
  const ppUps = [
    v.getUint8(0x34),
    v.getUint8(0x35),
    v.getUint8(0x36),
    v.getUint8(0x37),
  ];

  const iv32 = v.getUint32(0x38, true);
  const ivs = {
    hp:  (iv32 >>> 0)  & 0x1F,
    atk: (iv32 >>> 5)  & 0x1F,
    def: (iv32 >>> 10) & 0x1F,
    spe: (iv32 >>> 15) & 0x1F,
    spa: (iv32 >>> 20) & 0x1F,
    spd: (iv32 >>> 25) & 0x1F,
  };
  const ivTotal = ivs.hp + ivs.atk + ivs.def + ivs.spe + ivs.spa + ivs.spd;
  const isEgg       = !!(iv32 & (1 << 30));
  const isNicknamed = !!(iv32 & (1 << 31));

  // ShinyLeaf byte (HGSS exclusive)
  const shinyLeaf = v.getUint8(0x41);

  // Block C
  const nickname  = decodePk4String(raw, 0x48, 10);
  const gameVersion = v.getUint8(0x5F);

  // Block D
  const otName     = decodePk4String(raw, 0x68, 7);
  const eggYear    = v.getUint8(0x78);
  const eggMonth   = v.getUint8(0x79);
  const eggDay     = v.getUint8(0x7A);
  const metYear    = v.getUint8(0x7B);
  const metMonth   = v.getUint8(0x7C);
  const metDay     = v.getUint8(0x7D);
  const eggLoc     = v.getUint16(0x7E, true);
  const metLoc     = v.getUint16(0x80, true);
  const pokerus    = v.getUint8(0x82);
  const ball       = v.getUint8(0x83);
  const metLevel   = v.getUint8(0x84) & 0x7F;
  const otGender   = (v.getUint8(0x84) >>> 7) & 0x01;

  // Battle stats (party only — bytes present at 0x88+)
  let level = 0, currentHp = 0, maxHp = 0;
  let stats = { atk: 0, def: 0, spe: 0, spa: 0, spd: 0 };
  if (raw.length > 136) {
    level      = v.getUint8(0x8C);
    currentHp  = v.getUint16(0x8E, true);
    maxHp      = v.getUint16(0x90, true);
    stats = {
      atk: v.getUint16(0x92, true),
      def: v.getUint16(0x94, true),
      spe: v.getUint16(0x96, true),
      spa: v.getUint16(0x98, true),
      spd: v.getUint16(0x9A, true),
    };
  }

  // Derived values
  const nature   = pid % 25;
  const abilitySlot = pid & 1; // which of the two possible abilities

  // Shiny check: TID ^ SID ^ (PID>>16) ^ (PID&0xFFFF) < 8
  const shinyVal = (tid ^ sid ^ (pid >>> 16) ^ (pid & 0xFFFF));
  const isShiny  = shinyVal < 8;

  // Hidden Power type and power (Gen 4 formula)
  const hpTypeBits = (ivs.hp & 1) | ((ivs.atk & 1) << 1) | ((ivs.def & 1) << 2) |
                     ((ivs.spe & 1) << 3) | ((ivs.spa & 1) << 4) | ((ivs.spd & 1) << 5);
  const hpPowBits  = ((ivs.hp >> 1) & 1) | (((ivs.atk >> 1) & 1) << 1) |
                     (((ivs.def >> 1) & 1) << 2) | (((ivs.spe >> 1) & 1) << 3) |
                     (((ivs.spa >> 1) & 1) << 4) | (((ivs.spd >> 1) & 1) << 5);
  const hpType  = HP_TYPES[Math.floor((hpTypeBits * 15) / 63)];
  const hpPower = Math.floor((hpPowBits * 40) / 63) + 30;

  const pokerusStrain = (pokerus >> 4) & 0xF;
  const pokerusDays   = pokerus & 0xF;
  const hasPokerus    = pokerusStrain > 0;
  const pokerusCured  = pokerusStrain > 0 && pokerusDays === 0;

  const metDate = metYear ? `20${String(metYear).padStart(2,'0')}-${String(metMonth).padStart(2,'0')}-${String(metDay).padStart(2,'0')}` : null;
  const eggDate = eggYear ? `20${String(eggYear).padStart(2,'0')}-${String(eggMonth).padStart(2,'0')}-${String(eggDay).padStart(2,'0')}` : null;

  return {
    // Identity
    species, pid, tid, sid, isEgg, isShiny, shinyVal,
    // Names
    nickname: isNicknamed ? nickname : null,
    otName,
    // Stats
    exp, level, friendship, ability, abilitySlot,
    nature, natureName: NATURES[nature],
    ivs, ivTotal,
    evs, evTotal,
    currentHp, maxHp, stats,
    // Moves
    moves, pp, ppUps,
    // Hidden Power
    hpType, hpPower,
    // Origin
    gameVersion, ball, metLevel, metLoc, metDate,
    otGender, eggLoc, eggDate, language,
    // Misc
    heldItem, pokerus, hasPokerus, pokerusCured, shinyLeaf,
  };
}

/**
 * Public API: decode a raw (possibly encrypted) PK4 byte slice.
 * @param {Uint8Array} data - 136 or 236 bytes
 * @returns {object|null} parsed Pokemon data, or null if the slot is empty
 */
export function decodePK4(data) {
  const v = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const species = v.getUint16(0x08, true); // quick pre-decrypt check on unencrypted header
  // Sanity: if PID=0 and checksum=0 and species after header is 0, slot is empty
  const pid = v.getUint32(0, true);
  const checksum = v.getUint16(6, true);
  if (pid === 0 && checksum === 0) return null;

  const decrypted = decryptPK4(data);
  const parsed = parsePK4(decrypted);

  // Skip genuinely empty slots (species 0 after decryption means empty)
  if (parsed.species === 0) return null;

  return parsed;
}
