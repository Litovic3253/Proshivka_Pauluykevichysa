"""otadata с активным слотом ota_1 — так, как её пишет ESP-IDF (otatool.py).
CRC считается через binascii (zlib), чтобы тест проверял нашу реализацию crc32 независимо."""
import binascii
import pathlib
import struct

OUT = pathlib.Path(__file__).resolve().parents[2] / 'tests' / 'fixtures' / 'esp32-otadata-slot1.bin'


def entry(seq: int) -> bytes:
    crc = binascii.crc32(struct.pack('<I', seq), 0xFFFFFFFF) & 0xFFFFFFFF
    return struct.pack('<I20sII', seq, b'\xff' * 20, 0xFFFFFFFF, crc)


blob = bytearray(b'\xff' * 0x2000)
blob[0:32] = entry(1)
blob[0x1000:0x1020] = entry(2)  # seq 2 → (2 - 1) % 2 = слот 1 (ota_1)
OUT.write_bytes(bytes(blob))
print('ok', OUT)
