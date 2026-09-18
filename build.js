const fs=require('fs'),path=require('path');
const R=d=>fs.readFileSync(path.join(__dirname,d),'utf8');

let tpl=R('src/template.html');
const topo=R('raw/countries-110m.json');
const wc=JSON.parse(R('raw/world-countries.json'));
const pop=JSON.parse(R('raw/wb-pop.json'));
const gdp=JSON.parse(R('raw/wb-gdp.json'));

// 中文名兜底：translations.zho → native.zho → 英文名
function zhOf(c){
  return (c.translations&&c.translations.zho&&c.translations.zho.common)
    ||(c.name&&c.name.native&&c.name.native.zho&&c.name.native.zho.common)
    ||c.name.common;
}
// 显示名精简覆盖
const ZH_FIX={TWN:'台湾',ARE:'阿联酋',COD:'刚果（金）',COG:'刚果（布）',CAF:'中非',CIV:'科特迪瓦',USA:'美国',GMB:'冈比亚',BIH:'波黑',MKD:'北马其顿',SSD:'南苏丹',EMU:'阿联酋'};
function rg(c){
  const r=c.region,s=c.subregion;
  if(r==='Americas')return s==='South America'?'S.America':'N.America';
  return ['Asia','Europe','Africa','Oceania'].includes(r)?r:'other';
}
const meta=wc.filter(c=>c.ccn3).map(c=>({
  iso3:c.cca3,
  num:String(c.ccn3).padStart(3,'0'),
  zh:ZH_FIX[c.cca3]||zhOf(c),
  en:c.name.common,
  rg:rg(c)
}));

function collect(rows,keep){
  const o={};
  (rows[1]||[]).forEach(r=>{
    if(r&&r.value!=null&&r.countryiso3code&&keep.has(r.countryiso3code))
      o[r.countryiso3code]={v:r.value,y:+r.date};
  });
  return o;
}
const keep=new Set(meta.map(m=>m.iso3));
keep.add('WLD'); // 世界总量参考
const vals={
  pop:collect(pop,keep),
  gdp:collect(gdp,keep)
};
const wld={pop:vals.pop.WLD||null,gdp:vals.gdp.WLD||null};
delete vals.pop.WLD;delete vals.gdp.WLD;
// 世界银行不覆盖台湾，手动补（2024年估计）
vals.pop.TWN={v:23420000,y:2024};
vals.gdp.TWN={v:7.75e11,y:2024};

const safe=s=>s.replace(/<\//g,'<\\/');
const data=JSON.stringify({meta,vals,wld});

const out=tpl
  .replace('__TOPO__',()=>safe(topo))
  .replace('__DATA__',()=>safe(data))
  .replace('/*__CSS__*/',()=>R('src/style.css'))
  .replace('__D3__',()=>R('raw/d3.min.js'))
  .replace('__TOPOJSON__',()=>R('raw/topojson-client.min.js'))
  .replace('__APP__',()=>R('src/app.js'));

fs.writeFileSync(path.join(__dirname,'index.html'),out);
console.log('index.html built:',(out.length/1024).toFixed(0)+' KB');
console.log('countries with pop:',Object.keys(vals.pop).length,'| with gdp:',Object.keys(vals.gdp).length);
console.log('WLD pop:',wld.pop&&wld.pop.v,wld.pop&&wld.pop.y,'| WLD gdp:',wld.gdp&&wld.gdp.v,wld.gdp&&wld.gdp.y);
