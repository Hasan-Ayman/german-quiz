// Reconstruct text-only, partly bordered tables from reviewed row anchors.
// Column boundaries are supplied explicitly; this never approves table semantics.
export function alignedRows(words,anchors,columns,maxHeight=28){
 return anchors.map((anchor,index)=>{
  if(!anchor)throw Error('Missing printed row anchor')
  const next=anchors[index+1]
  const end=Math.min(next?next.top-1:anchor.top+15,anchor.top+maxHeight)
  return columns.map(([x0,x1])=>words.filter(w=>w.x0>=x0&&w.x0<x1&&w.top>=anchor.top-1&&w.top<end)
   .sort((a,b)=>Math.abs(a.top-b.top)<3?a.x0-b.x0:a.top-b.top).map(w=>w.text).join(' '))
 })
}
