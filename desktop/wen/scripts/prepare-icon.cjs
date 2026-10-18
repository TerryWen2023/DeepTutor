const fs = require('node:fs');
const path = require('node:path');
const sharp = require('sharp');
async function main() {
  const source = process.argv[2];
  if (!source) throw new Error('Usage: node scripts/prepare-icon.cjs <generated-image.png>');
  const root = path.resolve(__dirname, '..');
  fs.mkdirSync(path.join(root, 'assets'), {recursive:true});
  fs.mkdirSync(path.join(root, 'public'), {recursive:true});
  // Only format conversion/resampling of the original generated asset.
  await sharp(source).resize(1024, 1024, {fit:'contain', background:'#00000000'}).png().toFile(path.join(root, 'assets/icon.png'));
  await sharp(source).resize(256,256).png().toFile(path.join(root,'public/icon.png'));
  const sizes = [16,24,32,48,64,128,256];
  const frames = await Promise.all(sizes.map(size => sharp(source).resize(size,size).png().toBuffer()));
  const head = Buffer.alloc(6 + 16 * frames.length);
  head.writeUInt16LE(1,2); head.writeUInt16LE(frames.length,4);
  let offset=head.length;
  frames.forEach((frame,i)=> {
    const p=6+i*16;
    head[p]=sizes[i]===256?0:sizes[i]; head[p+1]=head[p];
    head.writeUInt16LE(1,p+4); head.writeUInt16LE(32,p+6);
    head.writeUInt32LE(frame.length,p+8); head.writeUInt32LE(offset,p+12);
    offset+=frame.length;
  });
  fs.writeFileSync(path.join(root,'assets/icon.ico'),Buffer.concat([head,...frames]));
  console.log('Created assets/icon.png, assets/icon.ico, public/icon.png');
}
main().catch(e=>{console.error(e.message); process.exitCode=1;});
