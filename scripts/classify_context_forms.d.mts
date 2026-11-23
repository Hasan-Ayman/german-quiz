export interface ContextOccurrence {
 surface:string
 context:string
 top:number
 pageHeight:number
 document:string
}
export interface ContextIndex {
 lemmas:Map<string,unknown[]>
 folded:Map<string,unknown[]>
 forms:Map<string,unknown[]>
}
export interface ClassificationPolicy {
 names?:string[]
 ambiguous?:string[]
 artifacts?:string[]
 candidates?:string[]
}
export function classifyOccurrence(occurrence:ContextOccurrence,index:ContextIndex,policy?:ClassificationPolicy):{
 category:string
 reason:string
 refs:unknown[]
 verification:'automated_context_classification'
 humanVerified:false
 active:false
}
export function classifyArchives(oldFolder:string,datasetFile:string,output:string,policyFile?:string):Promise<unknown>
