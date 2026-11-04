import recommend from './recommend.js';

export default {
  async fetch() {
    const payload = {
      seed: 'backend-selftest-v1',
      note: 'quiet, intimate, warm, melancholic, low energy, not upbeat',
      moods: ['yearning','tender','melancholic','warm'],
      energy: 3,
      comfort: 'exploration',
      time: 60,
      intent: { avoidGenres: [], avoidMoods: { energetic: 1 } },
      recentArtists: [],
      candidates: [
        { id:'quiet1', artist:'Sufjan Stevens', title:'Carrie & Lowell', genres:['indie folk'], tags:['intimate','melancholic','acoustic'], moods:['tender','melancholic','yearning'], energy:2, duration:44, familiarity:0, localScore:.92, semanticScore:.65 },
        { id:'rock1', artist:'The Strokes', title:'Is This It', genres:['garage rock'], tags:['energetic','rock'], moods:['energetic','gritty'], energy:7, duration:36, familiarity:.1, localScore:.35, semanticScore:.2 },
        { id:'quiet2', artist:'Adrianne Lenker', title:'songs', genres:['folk'], tags:['intimate','tender','quiet'], moods:['tender','warm','yearning'], energy:2, duration:39, familiarity:0, localScore:.9, semanticScore:.55 },
        { id:'upbeat1', artist:'Paramore', title:'After Laughter', genres:['pop rock'], tags:['upbeat','bright','energetic'], moods:['energetic','bittersweet'], energy:8, duration:42, familiarity:0, localScore:.25, semanticScore:.1 }
      ]
    };
    const req = new Request('https://internal.test/api/recommend', {
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify(payload)
    });
    const res = await recommend.fetch(req);
    return new Response(await res.text(), {
      status:res.status,
      headers:{'Content-Type':'application/json','Cache-Control':'no-store'}
    });
  }
};
