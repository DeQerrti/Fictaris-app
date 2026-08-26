// Минимальный ZIP-писатель — без сжатия (store), только то, что нужно
// для валидного .docx: OOXML-документ это ZIP-архив с определённым
// набором XML-частей. Внешней библиотеки для этого в проекте нет (весь
// фронтенд — ванильный JS без сборки), а .docx не обязан быть сжат —
// метод store (0) такой же законный ZIP, как и deflate, и Word/LibreOffice
// открывают его без вопросов. Экономия на компрессоре ощутимо упрощает
// код за счёт которой рукопись весит чуть больше — приемлемо для текста.

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function dosDateTime(date) {
  const time = ((date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1)) & 0xffff;
  const day = (((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate()) & 0xffff;
  return { time, day };
}

class ByteWriter {
  constructor() {
    this.chunks = [];
    this.length = 0;
  }
  bytes(arr) {
    this.chunks.push(arr);
    this.length += arr.length;
    return this;
  }
  u16(v) {
    return this.bytes(new Uint8Array([v & 0xff, (v >>> 8) & 0xff]));
  }
  u32(v) {
    return this.bytes(new Uint8Array([v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff]));
  }
  build() {
    const out = new Uint8Array(this.length);
    let offset = 0;
    for (const chunk of this.chunks) {
      out.set(chunk, offset);
      offset += chunk.length;
    }
    return out;
  }
}

// files: [{ name: string, text: string }] — все части .docx текстовые (XML).
export function buildZip(files) {
  const encoder = new TextEncoder();
  const now = new Date();
  const { time, day } = dosDateTime(now);
  const local = new ByteWriter();
  const central = new ByteWriter();
  const offsets = [];

  for (const file of files) {
    const nameBytes = encoder.encode(file.name);
    const dataBytes = encoder.encode(file.text);
    const crc = crc32(dataBytes);

    offsets.push(local.length);
    local.u32(0x04034b50);
    local.u16(20); // version needed
    local.u16(0); // flags
    local.u16(0); // method: store
    local.u16(time);
    local.u16(day);
    local.u32(crc);
    local.u32(dataBytes.length); // compressed size == uncompressed (store)
    local.u32(dataBytes.length);
    local.u16(nameBytes.length);
    local.u16(0); // extra field length
    local.bytes(nameBytes);
    local.bytes(dataBytes);
  }

  files.forEach((file, i) => {
    const nameBytes = encoder.encode(file.name);
    const dataBytes = encoder.encode(file.text);
    const crc = crc32(dataBytes);

    central.u32(0x02014b50);
    central.u16(20); // version made by
    central.u16(20); // version needed
    central.u16(0); // flags
    central.u16(0); // method
    central.u16(time);
    central.u16(day);
    central.u32(crc);
    central.u32(dataBytes.length);
    central.u32(dataBytes.length);
    central.u16(nameBytes.length);
    central.u16(0); // extra
    central.u16(0); // comment
    central.u16(0); // disk number start
    central.u16(0); // internal attrs
    central.u32(0); // external attrs
    central.u32(offsets[i]);
    central.bytes(nameBytes);
  });

  const localBytes = local.build();
  const centralBytes = central.build();

  const end = new ByteWriter();
  end.u32(0x06054b50);
  end.u16(0); // disk number
  end.u16(0); // disk with central dir
  end.u16(files.length);
  end.u16(files.length);
  end.u32(centralBytes.length);
  end.u32(localBytes.length); // offset of central dir
  end.u16(0); // comment length

  const total = new Uint8Array(localBytes.length + centralBytes.length + end.length);
  total.set(localBytes, 0);
  total.set(centralBytes, localBytes.length);
  total.set(end.build(), localBytes.length + centralBytes.length);
  return total;
}
