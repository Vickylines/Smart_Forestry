// ZIP store format with UTF-8 filenames; photos do not need recompression.
export function crc32(bytes: Uint8Array): number {
  let crc=0xffffffff;
  for (const b of bytes) {crc^=b;for(let k=0;k<8;k++) crc=(crc>>>1)^((crc&1)?0xedb88320:0);}
  return (crc^0xffffffff)>>>0;
}
export async function makeZip(entries: Array<{name:string;blob:Blob}>): Promise<Blob> {
  if(entries.length>65000) throw new Error('导出文件过多，请拆分项目');
  const parts: BlobPart[]=[]; const central: BlobPart[]=[];let offset=0,centralSize=0;
  for(const entry of entries) {
    if (!entry.name || entry.name.startsWith('/') || entry.name.includes('..') || entry.name.includes('\\')) throw new Error('导出文件名无效');
    const name=new TextEncoder().encode(entry.name); const bytes=new Uint8Array(await entry.blob.arrayBuffer()); const crc=crc32(bytes);
    const local=new Uint8Array(30);const v=new DataView(local.buffer);
    v.setUint32(0,0x04034b50,true);v.setUint16(4,20,true);v.setUint16(6,0x800,true);v.setUint16(12,33,true);
    v.setUint32(14,crc,true);v.setUint32(18,bytes.length,true);v.setUint32(22,bytes.length,true);v.setUint16(26,name.length,true);
    parts.push(local,name,entry.blob);
    const header=new Uint8Array(46);const c=new DataView(header.buffer);
    c.setUint32(0,0x02014b50,true);c.setUint16(4,20,true);c.setUint16(6,20,true);c.setUint16(8,0x800,true);c.setUint16(14,33,true);
    c.setUint32(16,crc,true);c.setUint32(20,bytes.length,true);c.setUint32(24,bytes.length,true);c.setUint16(28,name.length,true);c.setUint32(42,offset,true);
    central.push(header,name);centralSize+=46+name.length;offset+=30+name.length+bytes.length;
    if(offset>200*1024*1024) throw new Error('资料包超过200MB，请分项目导出');
  }
  const end=new Uint8Array(22);const e=new DataView(end.buffer);e.setUint32(0,0x06054b50,true);e.setUint16(8,entries.length,true);e.setUint16(10,entries.length,true);e.setUint32(12,centralSize,true);e.setUint32(16,offset,true);
  return new Blob([...parts,...central,end],{type:'application/zip'});
}
