import multer from 'multer';
import { uploadProductObject } from './storage.service.js';
const ALLOWED_TYPES=new Set(['image/jpeg','image/png','image/webp']);
export const uploadProductImage=multer({storage:multer.memoryStorage(),limits:{fileSize:5*1024*1024},fileFilter:(_req,file,cb)=>ALLOWED_TYPES.has(file.mimetype)?cb(null,true):cb(new Error('Only JPG, PNG, or WEBP images are allowed.'))}).single('image');
export async function storeUploadedProductImage(file){return uploadProductObject(file.buffer,file.mimetype,file.originalname);}
