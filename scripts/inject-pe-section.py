#!/usr/bin/env python3
"""
Injects a .bun section into a Windows PE executable (bun standalone format).
Usage: inject-pe-section.py <bun-exe> <bundle-bytes> <output-exe>
"""

import sys
import struct
import os

def align_up(value, alignment):
    return (value + alignment - 1) & ~(alignment - 1)

def read_u16(data, offset): return struct.unpack_from('<H', data, offset)[0]
def read_u32(data, offset): return struct.unpack_from('<I', data, offset)[0]
def read_u64(data, offset): return struct.unpack_from('<Q', data, offset)[0]
def write_u16(data, offset, val): struct.pack_into('<H', data, offset, val)
def write_u32(data, offset, val): struct.pack_into('<I', data, offset, val)
def write_u64(data, offset, val): struct.pack_into('<Q', data, offset, val)

def add_bun_section(pe_bytes, bundle_bytes):
    data = bytearray(pe_bytes)

    # PE header offset at 0x3C
    e_lfanew = read_u32(data, 0x3C)
    pe_sig = data[e_lfanew:e_lfanew+4]
    assert pe_sig == b'PE\0\0', f"Not a PE file: {pe_sig!r}"

    coff_offset = e_lfanew + 4
    machine = read_u16(data, coff_offset)
    num_sections = read_u16(data, coff_offset + 2)
    size_of_optional = read_u16(data, coff_offset + 16)

    opt_offset = coff_offset + 20
    magic = read_u16(data, opt_offset)
    assert magic == 0x20B, f"Expected PE32+ (0x20B), got 0x{magic:X}"

    # Optional header fields (PE32+)
    file_alignment    = read_u32(data, opt_offset + 36)
    section_alignment = read_u32(data, opt_offset + 32)
    size_of_image     = read_u32(data, opt_offset + 56)
    size_of_headers   = read_u32(data, opt_offset + 60)
    checksum_offset   = opt_offset + 64
    # Data directories start at opt_offset + 112 for PE32+
    # Security directory is entry 4
    security_dd_offset = opt_offset + 112 + 4 * 8  # entry 4, each entry 8 bytes

    # Section headers follow the optional header
    section_headers_offset = opt_offset + size_of_optional
    SECTION_HEADER_SIZE = 40

    # Parse existing sections
    sections = []
    for i in range(num_sections):
        off = section_headers_offset + i * SECTION_HEADER_SIZE
        name         = data[off:off+8]
        virtual_size = read_u32(data, off + 8)
        virtual_addr = read_u32(data, off + 12)
        raw_size     = read_u32(data, off + 16)
        raw_ptr      = read_u32(data, off + 20)
        chars        = read_u32(data, off + 36)
        sections.append({
            'name': name, 'virtual_size': virtual_size, 'virtual_addr': virtual_addr,
            'raw_size': raw_size, 'raw_ptr': raw_ptr, 'chars': chars, 'off': off
        })

        if name == b'.bun\0\0\0\0':
            raise ValueError("PE already has a .bun section")

    assert num_sections < 96, "Too many sections"

    # Check header space
    new_sh_off = section_headers_offset + num_sections * SECTION_HEADER_SIZE
    new_sh_end = new_sh_off + SECTION_HEADER_SIZE
    first_raw = min((s['raw_ptr'] for s in sections if s['raw_size'] > 0), default=len(data))
    new_size_of_headers = align_up(new_sh_end, file_alignment)
    assert new_size_of_headers <= first_raw, f"Insufficient header space: need {new_size_of_headers}, first_raw={first_raw}"

    # Find last file end and last va end
    last_file_end = max((s['raw_ptr'] + s['raw_size'] for s in sections), default=0)
    last_va_end = max(
        (s['virtual_addr'] + align_up(max(s['virtual_size'], s['raw_size']), section_alignment)
         for s in sections),
        default=0
    )

    payload_len = len(bundle_bytes) + 8  # 8-byte u64 LE length prefix
    raw_size_new = align_up(payload_len, file_alignment)
    new_va  = align_up(last_va_end, section_alignment)
    new_raw = align_up(last_file_end, file_alignment)

    # Extend data buffer
    new_file_size = new_raw + raw_size_new
    if len(data) < new_file_size:
        data.extend(b'\0' * (new_file_size - len(data)))
    else:
        # Zero the new section area
        data[new_raw:new_file_size] = b'\0' * raw_size_new

    # Write new section header
    IMAGE_SCN_CNT_INITIALIZED_DATA = 0x00000040
    IMAGE_SCN_MEM_READ              = 0x40000000
    sh = bytearray(SECTION_HEADER_SIZE)
    sh[0:8] = b'.bun\0\0\0\0'
    struct.pack_into('<I', sh, 8,  payload_len)   # VirtualSize
    struct.pack_into('<I', sh, 12, new_va)          # VirtualAddress
    struct.pack_into('<I', sh, 16, raw_size_new)    # SizeOfRawData
    struct.pack_into('<I', sh, 20, new_raw)          # PointerToRawData
    struct.pack_into('<I', sh, 36, IMAGE_SCN_CNT_INITIALIZED_DATA | IMAGE_SCN_MEM_READ)
    data[new_sh_off:new_sh_off + SECTION_HEADER_SIZE] = sh

    # Write payload: u64 LE length + bundle bytes
    write_u64(data, new_raw, len(bundle_bytes))
    data[new_raw + 8: new_raw + 8 + len(bundle_bytes)] = bundle_bytes

    # Update COFF: number_of_sections
    write_u16(data, coff_offset + 2, num_sections + 1)

    # Update optional header
    if size_of_headers < new_size_of_headers:
        write_u32(data, opt_offset + 60, new_size_of_headers)

    # size_of_image: aligned end of new section
    new_size_of_image = align_up(new_va + payload_len, section_alignment)
    write_u32(data, opt_offset + 56, new_size_of_image)

    # Clear security directory (signature invalidated)
    data[security_dd_offset:security_dd_offset + 8] = b'\0' * 8

    # Recompute PE checksum
    data = recompute_checksum(data, checksum_offset)

    return bytes(data)


def recompute_checksum(data, checksum_offset):
    # Zero out the checksum field first
    write_u32(data, checksum_offset, 0)

    checksum = 0
    # Process data as u16 pairs
    for i in range(0, len(data) - 1, 2):
        val = struct.unpack_from('<H', data, i)[0]
        checksum += val
        if checksum > 0xFFFFFFFF:
            checksum = (checksum & 0xFFFFFFFF) + (checksum >> 32)

    if len(data) % 2:
        checksum += data[-1]

    # Fold to 32 bits
    checksum = (checksum & 0xFFFF) + (checksum >> 16)
    checksum += checksum >> 16
    checksum &= 0xFFFF
    checksum += len(data)

    write_u32(data, checksum_offset, checksum)
    return data


if __name__ == '__main__':
    if len(sys.argv) != 4:
        print(f"Usage: {sys.argv[0]} <bun-exe> <bundle-js> <output-exe>")
        sys.exit(1)

    bun_path, bundle_path, out_path = sys.argv[1], sys.argv[2], sys.argv[3]

    with open(bun_path, 'rb') as f:
        pe_bytes = f.read()

    with open(bundle_path, 'rb') as f:
        bundle_bytes = f.read()

    print(f"Bun exe: {len(pe_bytes)//1024//1024}MB, Bundle: {len(bundle_bytes)//1024}KB")

    result = add_bun_section(pe_bytes, bundle_bytes)

    with open(out_path, 'wb') as f:
        f.write(result)

    try:
        os.chmod(out_path, 0o755)
    except (PermissionError, OSError):
        pass
    print(f"Output: {len(result)//1024//1024}MB -> {out_path}")
