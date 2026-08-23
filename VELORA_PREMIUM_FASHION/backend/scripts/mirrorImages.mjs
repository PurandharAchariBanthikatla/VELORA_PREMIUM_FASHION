// Mirrors every product image from the catalog into S3 and rewrites products.json.
// Run once in a networked deployment environment with AWS credentials.
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
const root=path.resolve(new URL('../..',import.meta.url).pathname); const file=path.join(root,'backend/data/products.json');
const bucket=process.env.S3_BUCKET; if(!bucket) throw new Error('S3_BUCKET required');
const region=process.env.AWS_REGION||'ap-south-1'; const base=(process.env.S3_PUBLIC_BASE_URL||`https://${bucket}.s3.${region}.amazonaws.com`).replace(/\/$/,'');
const s3=new S3Client({region,endpoint:process.env.S3_ENDPOINT||undefined}); const products=JSON.parse(await fs.readFile(file,'utf8'));
for(let i=0;i<products.length;i++){
 const p=products[i]; if(!/^https?:\/\//i.test(p.image)) continue;
 const r=await fetch(p.image); if(!r.ok) throw new Error(`Image ${p.id} returned ${r.status}`);
 const type=r.headers.get('content-type')?.split(';')[0]||'image/jpeg'; const ext=type==='image/png'?'.png':type==='image/webp'?'.webp':'.jpg'; const key=`products/${crypto.createHash('sha256').update(p.id).digest('hex')}${ext}`;
 await s3.send(new PutObjectCommand({Bucket:bucket,Key:key,Body:Buffer.from(await r.arrayBuffer()),ContentType:type,CacheControl:'public,max-age=31536000,immutable'}));
 p.image=`${base}/${key}`; if((i+1)%25===0) console.log(`Mirrored ${i+1}/${products.length}`);
}
await fs.writeFile(file,JSON.stringify(products,null,2)+'\n'); console.log(`Mirrored catalog images. Updated ${file}`);
