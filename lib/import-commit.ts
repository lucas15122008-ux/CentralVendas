export type SavedImport={id:string;withdrawnAt:string|null};

// D1 batches are transactional, but a lost response does not prove rollback.
// Confirm the outcome before discarding any document from R2.
export async function commitImportBatch({id,commit,findSaved,discard}:{
 id:string;
 commit:()=>Promise<unknown>;
 findSaved:()=>Promise<SavedImport|null>;
 discard:()=>Promise<unknown>;
}):Promise<SavedImport|null>{
 try{await commit();return null;}catch(error){
  let saved:SavedImport|null;
  try{saved=await findSaved();}catch{throw error;}
  if(saved?.id!==id){try{await discard();}catch{/* Retain an orphan if cleanup is unavailable. */}}
  if(saved)return saved;
  throw error;
 }
}
