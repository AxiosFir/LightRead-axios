import assert from 'node:assert/strict'
import { test } from 'node:test'
import { deflateRawSync } from 'node:zlib'
import { verifyApkLayout, verifyNativeLibraries } from './apk-layout.mjs'
function fixture(padding) {
 const local = Buffer.alloc(34); local.writeUInt32LE(0x04034b50); local.writeUInt32LE(4,18)
 const central = Buffer.alloc(46); central.writeUInt32LE(0x02014b50); central.writeUInt32LE(4,20)
 const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50); end.writeUInt16LE(1,8); end.writeUInt16LE(1,10); end.writeUInt32LE(46,12); end.writeUInt32LE(local.length+padding,16)
 return Buffer.concat([local,Buffer.alloc(padding),central,end])
}
test('allows ordinary APK signing/alignment space',()=>assert.equal(verifyApkLayout(fixture(16384)).largestGap,16384))
test('rejects stale incremental ZIP padding even when central directory is valid',()=>assert.throws(()=>verifyApkLayout(fixture(2*1024*1024)),/unused padding/))
test('rejects truncated ZIP',()=>assert.throws(()=>verifyApkLayout(fixture(0).subarray(0,30)),/directory missing/))

// Minimal ELF64: null section, .shstrtab, then the given sections.
function elf(sections) {
 const strtab = Buffer.from(`\0.shstrtab\0${sections.map(name=>`${name}\0`).join('')}`, 'latin1')
 const count = sections.length + 2, shoff = 64 + strtab.length
 const head = Buffer.alloc(64); head.writeUInt32BE(0x7f454c46); head[4] = 2; head[5] = 1
 head.writeBigUInt64LE(BigInt(shoff),0x28); head.writeUInt16LE(64,0x3a); head.writeUInt16LE(count,0x3c); head.writeUInt16LE(1,0x3e)
 const table = Buffer.alloc(count*64)
 table.writeUInt32LE(1,64); table.writeBigUInt64LE(64n,64+24); table.writeBigUInt64LE(BigInt(strtab.length),64+32)
 let name = 11
 sections.forEach((section,i)=>{ table.writeUInt32LE(name,(i+2)*64); name += section.length + 1 })
 return Buffer.concat([head,strtab,table])
}
function apk(files) {
 const locals = [], centrals = []
 let offset = 0
 for (const { name, data, deflate } of files) {
  const body = deflate ? deflateRawSync(data) : data, nameBytes = Buffer.from(name)
  const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50); local.writeUInt16LE(deflate?8:0,8); local.writeUInt32LE(body.length,18); local.writeUInt16LE(nameBytes.length,26)
  const central = Buffer.alloc(46); central.writeUInt32LE(0x02014b50); central.writeUInt16LE(deflate?8:0,10); central.writeUInt32LE(body.length,20); central.writeUInt16LE(nameBytes.length,28); central.writeUInt32LE(offset,42)
  locals.push(local,nameBytes,body); centrals.push(central,nameBytes); offset += 30 + nameBytes.length + body.length
 }
 const directory = Buffer.concat(centrals)
 const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50); end.writeUInt16LE(files.length,8); end.writeUInt16LE(files.length,10); end.writeUInt32LE(directory.length,12); end.writeUInt32LE(offset,16)
 return Buffer.concat([...locals,directory,end])
}
const so = 'lib/arm64-v8a/liblightread_lib.so'
test('accepts native libraries without DWARF',()=>{
 const bytes = apk([{ name:'classes.dex', data:Buffer.alloc(8) },{ name:so, data:elf(['.text','.rodata','.symtab']) }])
 assert.deepEqual(verifyNativeLibraries(bytes).map(lib=>lib.name),[so])
 verifyApkLayout(bytes)
})
test('rejects Rust dev-profile debug info (stored .so)',()=>assert.throws(()=>verifyNativeLibraries(apk([{ name:so, data:elf(['.text','.debug_info','.debug_str']) }])),/debug_info, \.debug_str.*CARGO_PROFILE_DEV_DEBUG=0/))
test('rejects debug info in a compressed .so',()=>assert.throws(()=>verifyNativeLibraries(apk([{ name:so, data:elf(['.debug_line']), deflate:true }])),/debug sections/))
test('rejects an APK without native libraries',()=>assert.throws(()=>verifyNativeLibraries(apk([{ name:'classes.dex', data:Buffer.alloc(8) }])),/no native libraries/))
