import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
export function createMockService() {
  const app = express();
  app.get('/stock/:id',(req,res)=>{
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 1 || id > 12) return res.status(404).json({error:'Unknown sample product'});
    res.json({productId:id,available:20+id,warehouse:'Synthetic central store'});
  });
  return app;
}
if(process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  createMockService().listen(4101,'127.0.0.1',()=>console.log('Synthetic stock service: http://127.0.0.1:4101'));
}
