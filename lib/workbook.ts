import * as XLSX from 'xlsx';
export type WorkbookSheet={name:string;rows:unknown[][]};
export function readWorkbook(buffer:ArrayBuffer,filename:string):WorkbookSheet[]{
 if(buffer.byteLength>5*1024*1024)throw new Error('O arquivo deve ter no máximo 5 MB.');
 if(!/\.(csv|xlsx)$/i.test(filename))throw new Error('Envie uma planilha .xlsx ou um arquivo .csv.');
 if(/\.xlsx$/i.test(filename)){
  const view=new DataView(buffer);let end=-1;
  for(let p=buffer.byteLength-22;p>=Math.max(0,buffer.byteLength-65558);p--)if(view.getUint32(p,true)===0x06054b50){end=p;break;}
  if(end<0)throw new Error('Arquivo XLSX inválido. Exporte novamente pelo Excel ou Citel.');
  const count=view.getUint16(end+10,true);let offset=view.getUint32(end+16,true);let expanded=0;
  if(count>1000)throw new Error('Planilha muito complexa. Exporte somente a aba de custos.');
  for(let i=0;i<count;i++){if(offset+46>buffer.byteLength||view.getUint32(offset,true)!==0x02014b50)throw new Error('Estrutura de planilha inválida.');expanded+=view.getUint32(offset+24,true);if(expanded>25*1024*1024)throw new Error('Planilha muito grande após descompactação. Exporte uma aba menor.');offset+=46+view.getUint16(offset+28,true)+view.getUint16(offset+30,true)+view.getUint16(offset+32,true);}
 }
 const book=XLSX.read(buffer,{type:'array',cellDates:false,cellNF:true,sheetRows:5021,dense:true,raw:true});
 if(book.SheetNames.length>20)throw new Error('Envie um arquivo com até 20 abas.');
 return book.SheetNames.map(name=>{
  const sheet=book.Sheets[name];const range=XLSX.utils.decode_range(sheet['!fullref']??sheet['!ref']??'A1');
  if(range.e.r>=5021)throw new Error(`A aba ${name} ultrapassa o limite de 5.021 linhas físicas. Remova linhas vazias ou divida o arquivo; nenhuma linha será omitida.`);
  if(range.e.c>=200)throw new Error(`A aba ${name} tem mais de 200 colunas. Exporte somente as colunas necessárias.`);
  const dense=sheet['!data'] as XLSX.CellObject[][]|undefined;
  const rows:unknown[][]=[];
  for(let r=0;r<=range.e.r;r++){
   const row:unknown[]=[];
   for(let c=0;c<=range.e.c;c++){
    const cell=dense?.[r]?.[c]??sheet[XLSX.utils.encode_cell({r,c})];
    if(cell?.f&&(cell.v===undefined||cell.v===null)){row.push('#FORMULA_SEM_RESULTADO');continue;}
    if(cell?.t==='e'){row.push('#ERRO_NA_PLANILHA');continue;}
    if(cell?.t==='n'&&typeof cell.v==='number'){
     const format=String(cell.z??'').replace(/"[^"]*"/g,'').replace(/\\./g,'');
     row.push({numeric:cell.v,display:cell.w??XLSX.utils.format_cell(cell),percentage:format.includes('%')});
    }else row.push(cell?.v??'');
   }
   rows.push(row);
  }
  return {name,rows};
 });
}
