// Explicit listening judgments are long-term taste labels.
// A contextual correction is not a vote against the album's entire sound.
// This pure module is regression-tested separately from the Vercel Blob store.
export function tasteWeights(event, rating) {
 if(event==='love_this')return {positive:1.75,negative:0};
 if(event==='less_like_this')return {positive:0,negative:1.25};
 if(event==='rating'){
  const r=Number(rating);
  if(!Number.isFinite(r)||r<=0)return {positive:0,negative:0};
  if(r>=4.5)return {positive:2,negative:0};
  if(r>=3.5)return {positive:1.1,negative:0};
  if(r<=1.5)return {positive:0,negative:2};
  if(r<=2.5)return {positive:0,negative:1};
 }
 // Merely seeing, saving or opening music does not establish enjoyment.
 // A wrong-vibe / too-fast / artist-variety request is context, not taste.
 return {positive:0,negative:0};
}
