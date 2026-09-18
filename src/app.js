(function(){
'use strict';
var errbar=document.getElementById('errbar');
window.onerror=function(m,s,l){errbar.style.display='block';errbar.textContent='⚠ Error: '+m+' @line '+(l||'?');};

var topo=JSON.parse(document.getElementById('world-topo').textContent);
var DATA=JSON.parse(document.getElementById('app-data').textContent);

var RG_NAME={Asia:'Asia',Europe:'Europe',Africa:'Africa','N.America':'North America','S.America':'South America',Oceania:'Oceania',other:'Other'};
var RG_COLOR={Asia:'#ff6b6b',Europe:'#4dabf7',Africa:'#ffd43b','N.America':'#ffa94d','S.America':'#51cf66',Oceania:'#da77f2',other:'#9aa3b5'};
var RG_ORDER=['Asia','Europe','Africa','N.America','S.America','Oceania'];
var NEUT_FILL='#a8b6d8',NEUT_STROKE='rgba(255,255,255,0.38)';

function trim(s){return s.replace(/(\.\d*?)0+$/,'$1').replace(/\.$/,'');}
function fmtPop(v){
  if(v>=1e9)return trim((v/1e9).toFixed(2))+'B';
  if(v>=1e6)return trim((v/1e6).toFixed(1))+'M';
  if(v>=1e3)return Math.round(v/1e3).toLocaleString('en-US')+'K';
  return String(Math.round(v));
}
function fmtGdp(v){
  if(v>=1e12)return '$'+trim((v/1e12).toFixed(2))+'T';
  if(v>=1e9)return '$'+trim((v/1e9).toFixed(1))+'B';
  if(v>=1e6)return '$'+Math.round(v/1e6).toLocaleString('en-US')+'M';
  return '$'+Math.round(v).toLocaleString('en-US');
}
function fmtUSD(v){return '$'+Math.round(v).toLocaleString('en-US');}
function fmtArea(v){
  if(v>=1e6)return trim((v/1e6).toFixed(2))+'M km²';
  if(v>=1e3)return Math.round(v/1e3).toLocaleString('en-US')+'K km²';
  return Math.round(v).toLocaleString('en-US')+' km²';
}

var MODES={
  pop:{label:'Population',fmt:fmtPop},
  gdp:{label:'GDP',fmt:fmtGdp},
  area:{label:'True Area',fmt:fmtArea}
};

var mode=/gdp/i.test(location.hash)?'gdp':(/area/i.test(location.hash)?'area':'pop');
var shapeMode=!/circle/i.test(location.search);
var ANIM=true;
try{ANIM=!/static=1/.test(location.search)&&!matchMedia('(prefers-reduced-motion: reduce)').matches;}catch(e){}

var recs=[],byIso={},maxV=1;
var selSet=new Set(),lastSel=null,hoverIso=null;
var tx=0,ty=0,k=1,dragging=false,dragMoved=false,lastPt=null,lastMouse=null;
var firstRender=true;

var metaByNum={};
DATA.meta.forEach(function(m){metaByNum[m.num]=m;});

function bigCentroid(geom){
  if(!geom)return [0,0];
  if(geom.type==='Polygon')return d3.geoCentroid(geom);
  var best=null,ba=-1;
  for(var i=0;i<geom.coordinates.length;i++){
    var a=d3.geoArea({type:'Polygon',coordinates:geom.coordinates[i]});
    if(a>ba){ba=a;best=geom.coordinates[i];}
  }
  return d3.geoCentroid({type:'Polygon',coordinates:best});
}

var features=topojson.feature(topo,topo.objects.countries).features;
features.forEach(function(f,i){
  f._i=i;
  var m=metaByNum[String(f.id==null?'':f.id).padStart(3,'0')];
  if(m){f.iso3=m.iso3;f.name=m.en;f.rg=m.rg;}
  else{f.iso3=null;f.name=(f.properties&&f.properties.name)||'Unknown';f.rg='other';}
  f.centroid=bigCentroid(f.geometry);
});

var AREA_VALS=null,worldTotal=0;
function getAreaVals(){ // km² per country, computed once from the geometry
  if(!AREA_VALS){
    AREA_VALS={};
    var R2=6371*6371;
    features.forEach(function(f){
      if(f.iso3)AREA_VALS[f.iso3]={v:d3.geoArea(f)*R2,y:null};
    });
  }
  return AREA_VALS;
}

function dataOf(iso3){
  var src=mode==='area'?getAreaVals():DATA.vals[mode];
  var d=src[iso3];
  return d&&d.v>0?d:null;
}

var stage=document.getElementById('stage');
var svg=d3.select('#map');
var root=svg.append('g');
var gTiles=root.append('g');
var tiles=[];
var nTiles=3;
var tooltip=document.getElementById('tooltip');

var projection=d3.geoMercator();
var path=d3.geoPath(projection);
var ghostProjection=d3.geoMercator(); // 幽灵专用:旋转到光标经度,轮廓永不跨反经线
var ghostPath=d3.geoPath(ghostProjection);
var ghostFeature={type:'Feature',geometry:{type:'Polygon',coordinates:[]}};
var W=0,H=0,maxR=80,worldW=0;

function buildTiles(){
  gTiles.selectAll('g.tile').remove();
  tiles=[];
  nTiles=Math.max(3,Math.ceil(W/worldW)+2);
  for(var i=0;i<nTiles;i++){
    (function(i){
      var g=gTiles.append('g').attr('class','tile').attr('transform','translate('+((i-1)*worldW)+',0)');
      var t={i:i,g:g};
      t.gGrat=g.append('path').attr('fill','none').attr('stroke','#141d33').attr('stroke-width',0.5);
      t.gLand=g.append('g');
      t.gDots=g.append('g');
      t.gGhost=g.append('g').style('display','none').style('pointer-events','none');
      t.gCirc=t.gGhost.append('circle').attr('fill-opacity',0.45).attr('stroke','#fff').attr('stroke-width',2).attr('stroke-dasharray','6 4').attr('vector-effect','non-scaling-stroke');
      t.gShp=t.gGhost.append('path').attr('fill-opacity',0.45).attr('stroke','#fff').attr('stroke-width',2)
        .attr('stroke-dasharray','6 4').attr('vector-effect','non-scaling-stroke').attr('stroke-linejoin','round').style('display','none');
      t.gTxt=t.gGhost.append('text').attr('text-anchor','middle').attr('dy',-8).attr('fill','#fff')
        .attr('font-size',12).attr('font-weight',600).attr('paint-order','stroke').attr('stroke','rgba(0,0,0,.55)').attr('stroke-width',3);
      t.gLand.selectAll('path').data(features,function(d){return d._i;}).join('path')
        .attr('class','land')
        .attr('d',path)
        .attr('stroke-width',0.6)
        .on('mousemove',function(e,f){moveTip(e,f);})
        .on('mouseleave',function(){tooltip.style.display='none';})
        .on('click',function(e,f){
          e.stopPropagation();
          if(dragMoved)return;
          if(f.iso3&&byIso[f.iso3])toggleSel(f.iso3);
        });
      tiles.push(t);
    })(i);
  }
}

function setup(){
  var r=stage.getBoundingClientRect();
  W=r.width;H=r.height;
  svg.attr('viewBox','0 0 '+W+' '+H);
  var scale=H/(2*Math.PI); // full Mercator world square (±85.05°, both poles) fits the viewport height
  worldW=H;                // world square width in px (== height): horizontal wrap period
  projection.scale(scale).translate([W/2,H/2]).center([0,0])
    .clipExtent([[-worldW,0],[2*worldW,worldW]]);
  ghostProjection.scale(scale).translate([W/2,H/2]).center([0,0]); // 幽灵投影:同比例,d3默认世界方格裁剪
  maxR=H*0.185;
  features.forEach(function(f){
    var p=projection(f.centroid);
    f.px=p?p[0]:0;f.py=p?p[1]:0;
    f.pathD=path(f)||'';
    f.area=Math.abs(path.area(f))||0;
    var c=path.centroid(f);
    f.cx=isNaN(c[0])?f.px:c[0];
    f.cy=isNaN(c[1])?f.py:c[1];
  });
  buildTiles();
  k=1;
  tx=(W-worldW)/2; // center one world copy on screen
  ty=0;            // full square visible on open: 85°N … 85°S, no pan/zoom needed
  applyView();
}

function clampPan(){
  var P=worldW*k;
  tx=((tx%P)+P)%P;
  var lo=H-worldW*k,hi=0;
  ty=lo<=hi?Math.min(hi,Math.max(lo,ty)):(lo+hi)/2;
}
function applyView(){
  clampPan();
  root.attr('transform','translate('+tx+','+ty+') scale('+k+')');
  tiles.forEach(function(t){
    t.gGrat.attr('stroke-width',0.5/k);
    t.gLand.selectAll('path').attr('stroke-width',0.6/k);
  });
  if(!shapeMode)restroke();
}
function zoomAt(cx,cy,f){
  var k2=Math.min(24,Math.max(1,k*f));
  tx=cx-(cx-tx)*k2/k;
  ty=cy-(cy-ty)*k2/k;
  k=k2;
  applyView();
}

function computeRecs(){
  recs=[];
  features.forEach(function(f){
    var d=f.iso3?dataOf(f.iso3):null;
    if(d)recs.push({f:f,d:d});
  });
  recs.sort(function(a,b){return b.d.v-a.d.v;});
  var total=d3.sum(recs,function(r){return r.d.v;});
  worldTotal=total;
  maxV=recs.length?recs[0].d.v:1;
  var maxArea=Math.PI*maxR*maxR;
  recs.forEach(function(r,i){
    r.rank=i+1;r.share=r.d.v/total;
    r.r=Math.max(1.1,maxR*Math.sqrt(r.d.v/maxV));
    r.s=mode==='area'?1:f2s(r.f,Math.max(maxArea*r.d.v/maxV,30)); // True Area 模式 s=1(真实比例)
  });
  byIso={};recs.forEach(function(r){byIso[r.f.iso3]=r;});
}
function f2s(f,target){
  if(!(f.area>0.01))return 0.3;
  return Math.sqrt(target/f.area);
}
function scT(f,s){
  return 'translate('+f.cx+','+f.cy+') scale('+s+') translate('+(-f.cx)+','+(-f.cy)+')';
}

function styleDot(el,d){
  var iso=d.f.iso3,isSel=selSet.has(iso),isHov=hoverIso===iso;
  if(shapeMode){
    el.attr('fill',isSel?RG_COLOR[d.f.rg]:NEUT_FILL)
      .attr('fill-opacity',isSel?0.85:(isHov?0.32:0.14))
      .attr('stroke',isSel?'#fff':(isHov?'#fff':NEUT_STROKE))
      .attr('stroke-width',isSel?1.4:(isHov?1.6:0.8));
  }else{
    el.attr('fill',isSel?RG_COLOR[d.f.rg]:NEUT_FILL)
      .attr('fill-opacity',isSel?0.85:(isHov?0.42:0.2))
      .attr('stroke',isSel?'#fff':(isHov?'#fff':'rgba(255,255,255,0.5)'))
      .attr('stroke-width',(isSel?1.6:(isHov?1.8:0.9))/k);
  }
}

function renderDots(animate,rebuild){
  var dur=animate&&ANIM?900:0;
  var dly=animate&&ANIM&&firstRender?5:0;
  tiles.forEach(function(t){
    if(rebuild)t.gDots.selectAll('g').remove();
    var seln=t.gDots.selectAll('g.dot').data(recs,function(d){return d.f.iso3;});
    var ent=seln.enter().append('g').attr('class','dot').attr('cursor','pointer');
    if(!shapeMode)ent.attr('transform',function(d){return 'translate('+d.f.px+','+d.f.py+')';});
    if(shapeMode){
      ent.append('g').attr('class','sc')
        .attr('transform',function(d){return scT(d.f,0.0001);})
        .append('path').attr('class','shp')
        .attr('d',function(d){return d.f.pathD;})
        .attr('vector-effect','non-scaling-stroke')
        .attr('stroke-linejoin','round');
    }else{
      ent.append('circle');
    }
    var txt=ent.append('text')
      .attr('class','lbl').attr('text-anchor','middle').attr('dy','0.35em')
      .attr('pointer-events','none').attr('fill','#fff').attr('font-weight',600)
      .attr('paint-order','stroke').attr('stroke','rgba(0,0,0,0.55)').attr('stroke-width',2.5);
    if(shapeMode)txt.attr('x',function(d){return d.f.cx;}).attr('y',function(d){return d.f.cy;});
    var all=ent.merge(seln).order();
    if(!shapeMode)all.attr('transform',function(d){return 'translate('+d.f.px+','+d.f.py+')';});
    if(shapeMode){
      all.select('g.sc')
        .transition().duration(dur).ease(d3.easeCubicInOut)
        .delay(function(d,i){return dly?i*dly:0;})
        .attr('transform',function(d){return scT(d.f,d.s);});
    }else{
      all.select('circle')
        .transition().duration(dur).ease(d3.easeCubicInOut)
        .delay(function(d,i){return dly?i*dly:0;})
        .attr('r',function(d){return d.r;});
    }
    all.select('text')
      .attr('font-size',12)
      .text(function(d){return selSet.has(d.f.iso3)?d.f.name:'';});
    all.on('mousemove',function(e,d){hoverIso=d.f.iso3;styleDot(d3.select(this).select(shapeMode?'path.shp':'circle'),d);moveTip(e,d.f);})
      .on('mouseleave',function(e,d){hoverIso=null;styleDot(d3.select(this).select(shapeMode?'path.shp':'circle'),d);tooltip.style.display='none';})
      .on('click',function(e,d){
        e.stopPropagation();
        if(dragMoved)return;
        toggleSel(d.f.iso3);
      });
    seln.exit().each(function(){
      var g=d3.select(this);
      if(shapeMode)g.select('g.sc').transition().duration(ANIM?400:0).attr('transform',function(d){return scT(d.f,0.0001);});
      else g.select('circle').transition().duration(ANIM?400:0).attr('r',0);
      g.transition().delay(ANIM?400:0).remove();
    });
    all.select(shapeMode?'path.shp':'circle').each(function(d){styleDot(d3.select(this),d);});
  });
  firstRender=false;
}

function restroke(){
  tiles.forEach(function(t){
    t.gDots.selectAll(shapeMode?'path.shp':'circle').each(function(d){styleDot(d3.select(this),d);});
  });
}

function toggleSel(iso){
  if(selSet.has(iso)){
    selSet.delete(iso);
    if(lastSel===iso)lastSel=selSet.size?Array.from(selSet).pop():null;
  }else{
    selSet.add(iso);
    lastSel=iso;
  }
  refreshSel();
}

function refreshSel(){
  restroke();
  var r=lastSel?byIso[lastSel]:null;
  tiles.forEach(function(t){
    t.gDots.selectAll('text.lbl').text(function(d){return selSet.has(d.f.iso3)?d.f.name:'';});
    if(r){
      t.gGhost.style('display',null);
      if(shapeMode){
        // 幽灵初始落在原位,移动鼠标后跟随光标(True Area 模式按光标纬度重投影)
        t.gGhost.attr('transform',null);
        t.gShp.style('display',null).attr('d',r.f.pathD).attr('fill',RG_COLOR[r.f.rg]);
        t.gCirc.style('display','none');
        t.gTxt.attr('x',r.f.cx).attr('y',r.f.cy);
      }else{
        t.gGhost.attr('transform','translate('+r.f.px+','+r.f.py+')');
        t.gCirc.style('display',null).attr('r',r.r).attr('fill',RG_COLOR[r.f.rg]);
        t.gShp.style('display','none');
        t.gTxt.attr('x',0).attr('y',0);
      }
      t.gTxt.text(r.f.name+' · '+(mode==='area'?'true size':MODES[mode].label+' equal-area'));
    }else{
      t.gGhost.style('display','none');
    }
  });
  if(r&&lastMouse)moveGhost(lastMouse[0],lastMouse[1]);
  document.querySelectorAll('#rank .row').forEach(function(row){
    row.classList.toggle('act',selSet.has(row.dataset.iso));
  });
}

function moveGhost(sx,sy){
  var mapX=(sx-tx)/k,mapY=(sy-ty)/k;
  var r=byIso[lastSel];
  if(!r)return;
  if(shapeMode&&mode==='area'){
    // thetruesize 行为:轮廓在光标处按墨卡托重新投影 — 拖向赤道变小,拖向两极变大。
    // 几何平移到"绝对经度 = -光标经度"处:旋转后质心恰在投影中心,
    // 幽灵永不跨越反经线 — 任何拖放位置都完整显示
    var ll=projection.invert([mapX,mapY]);
    if(!ll)return;
    var dLon=-ll[0]-r.f.centroid[0],dLat=ll[1]-r.f.centroid[1];
    ghostProjection.rotate([-ll[0],0]);
    ghostFeature.geometry.type=r.f.geometry.type;
    ghostFeature.geometry.coordinates=shiftedGeometry(r.f.geometry,dLon,dLat);
    var d=ghostPath(ghostFeature)||r.f.pathD;
    tiles.forEach(function(t){
      var lx=mapX-(t.i-1)*worldW;
      t.gGhost.attr('transform','translate('+(lx-W/2)+','+(mapY-H/2)+')');
      t.gShp.attr('d',d);
      t.gTxt.attr('x',lx).attr('y',mapY-8);
    });
    return;
  }
  tiles.forEach(function(t){
    var lx=mapX-(t.i-1)*worldW;
    if(shapeMode){
      t.gGhost.attr('transform','translate('+lx+','+mapY+') scale('+r.s+') translate('+(-r.f.cx)+','+(-r.f.cy)+')');
      t.gTxt.attr('x',0).attr('y',0);
    }else{
      t.gGhost.attr('transform','translate('+lx+','+mapY+')');
    }
  });
}
function shiftedGeometry(geom,dLon,dLat){
  function sh(ring){return ring.map(function(c){return [c[0]+dLon,c[1]+dLat];});}
  if(geom.type==='Polygon')return geom.coordinates.map(sh);
  return geom.coordinates.map(function(p){return p.map(sh);});
}

function tipHTML(f){
  var r=byIso[f.iso3];
  var h='<div class="tt-name">'+f.name+'</div>';
  if(r){
    if(mode==='area'){
      h+='<div class="tt-row">Area: <b>'+fmtArea(r.d.v)+'</b> <span class="yr">(Natural Earth)</span></div>';
      h+='<div class="tt-row"><b>'+(r.share*100).toFixed(1)+'%</b> of mapped land · Rank <b>#'+r.rank+'</b></div>';
      var parts=[];
      var p=DATA.vals.pop[f.iso3],g=DATA.vals.gdp[f.iso3];
      if(p)parts.push('Population: '+fmtPop(p.v));
      if(g)parts.push('GDP: '+fmtGdp(g.v));
      if(p&&g)parts.push('GDP per capita '+fmtUSD(g.v/p.v));
      if(parts.length)h+='<div class="tt-row">'+parts.join(' · ')+'</div>';
    }else{
      h+='<div class="tt-row">'+MODES[mode].label+': <b>'+MODES[mode].fmt(r.d.v)+'</b> <span class="yr">('+r.d.y+')</span></div>';
      h+='<div class="tt-row"><b>'+(r.share*100).toFixed(1)+'%</b> of world · Rank <b>#'+r.rank+'</b></div>';
      if(mode==='pop'){
        var g=DATA.vals.gdp[f.iso3];
        if(g)h+='<div class="tt-row">GDP: '+fmtGdp(g.v)+' · GDP per capita '+fmtUSD(g.v/r.d.v)+'</div>';
      }else{
        var p2=DATA.vals.pop[f.iso3];
        if(p2)h+='<div class="tt-row">Population: '+fmtPop(p2.v)+' · GDP per capita '+fmtUSD(r.d.v/p2.v)+'</div>';
      }
    }
  }else{
    h+='<div class="tt-row dim">No data</div>';
  }
  return h;
}

function moveTip(e,f){
  tooltip.style.display='block';
  tooltip.innerHTML=tipHTML(f);
  var x=e.clientX+16,y=e.clientY+14;
  tooltip.style.left=Math.min(x,innerWidth-292)+'px';
  tooltip.style.top=Math.min(y,innerHeight-110)+'px';
}

function buildPanel(){
  var list=document.getElementById('rank');
  list.innerHTML='';
  recs.forEach(function(r){
    var row=document.createElement('div');
    row.className='row';row.dataset.iso=r.f.iso3;
    row.dataset.nm=r.f.name;row.dataset.en=r.f.name;
    row.innerHTML='<span class="rk">'+r.rank+'</span>'
      +'<i class="dotc" style="background:'+RG_COLOR[r.f.rg]+'"></i>'
      +'<span class="nm">'+r.f.name+'</span>'
      +'<span class="vv">'+MODES[mode].fmt(r.d.v)+'</span>'
      +'<span class="sh">'+(r.share*100).toFixed(1)+'%</span>'
      +'<i class="bar" style="width:'+(r.d.v/maxV*100).toFixed(2)+'%"></i>';
    row.addEventListener('click',function(){toggleSel(r.f.iso3);});
    row.addEventListener('mouseenter',function(){hoverIso=r.f.iso3;restroke();});
    row.addEventListener('mouseleave',function(){hoverIso=null;restroke();});
    list.appendChild(row);
  });
  document.querySelectorAll('#rank .row').forEach(function(row){
    row.classList.toggle('act',selSet.has(row.dataset.iso));
  });
}

function updateHeader(){
  document.getElementById('mLabel').textContent=mode==='area'?'Mapped land area':'World '+MODES[mode].label.toLowerCase();
  var w=DATA.wld[mode];
  if(!w&&mode==='area'&&recs.length)w={v:worldTotal,y:null};
  document.getElementById('mTotal').textContent=w?MODES[mode].fmt(w.v):'—';
  document.getElementById('mYear').textContent=w?(w.y?('· Reference year '+w.y):'· Natural Earth 110m'):'';
  document.getElementById('btn-pop').classList.toggle('on',mode==='pop');
  document.getElementById('btn-gdp').classList.toggle('on',mode==='gdp');
  document.getElementById('btn-area').classList.toggle('on',mode==='area');
  document.getElementById('btn-shape').classList.toggle('on',shapeMode);
  document.getElementById('btn-circ').classList.toggle('on',!shapeMode);
}

function buildLegend(){
  var lg=document.getElementById('legend');
  lg.innerHTML='<div class="lg-t">Click to color · by continent</div>';
  RG_ORDER.forEach(function(rg){
    var d=document.createElement('div');
    d.className='lg';
    d.innerHTML='<i style="background:'+RG_COLOR[rg]+'"></i>'+RG_NAME[rg];
    lg.appendChild(d);
  });
}

function setMode(m){
  if(m===mode)return;
  mode=m;
  location.hash=m==='gdp'?'gdp':'pop';
  computeRecs();
  renderDots(true,false);
  buildPanel();
  updateHeader();
  refreshSel();
}

function setShape(sm){
  if(sm===shapeMode)return;
  shapeMode=sm;
  setup();
  computeRecs();
  renderDots(true,true);
  buildPanel();
  updateHeader();
  refreshSel();
}

document.getElementById('btn-pop').addEventListener('click',function(){setMode('pop');});
document.getElementById('btn-gdp').addEventListener('click',function(){setMode('gdp');});
document.getElementById('btn-area').addEventListener('click',function(){setMode('area');});
document.getElementById('btn-shape').addEventListener('click',function(){setShape(true);});
document.getElementById('btn-circ').addEventListener('click',function(){setShape(false);});
document.getElementById('q').addEventListener('input',function(e){
  var q=e.target.value.trim().toLowerCase();
  document.querySelectorAll('#rank .row').forEach(function(row){
    var hit=!q||row.dataset.nm.toLowerCase().indexOf(q)>=0;
    row.style.display=hit?'':'none';
  });
});
window.addEventListener('keydown',function(e){
  if(e.key==='Escape'){selSet.clear();lastSel=null;refreshSel();}
});

// —— pan / zoom (custom, infinite horizontal wrap) ——
svg.on('wheel',function(e){
  e.preventDefault();
  var p=d3.pointer(e,svg.node());
  zoomAt(p[0],p[1],Math.exp(-e.deltaY*0.0016));
});
svg.on('dblclick',function(e){
  e.preventDefault();
  var p=d3.pointer(e,svg.node());
  zoomAt(p[0],p[1],1.7);
});
svg.on('mousedown',function(e){
  dragging=true;dragMoved=false;
  lastPt=[e.clientX,e.clientY];
  svg.style('cursor','grabbing');
});
d3.select(window)
  .on('mousemove.pan',function(e){
    if(!dragging||!lastPt)return;
    var dx=e.clientX-lastPt[0],dy=e.clientY-lastPt[1];
    if(Math.abs(dx)+Math.abs(dy)>2)dragMoved=true;
    tx+=dx;ty+=dy;
    lastPt=[e.clientX,e.clientY];
    applyView();
  })
  .on('mouseup.pan',function(){
    dragging=false;
    svg.style('cursor','grab');
  });
svg.on('mousemove',function(e){
  var p=d3.pointer(e,svg.node());
  lastMouse=p;
  if(lastSel&&!dragging)moveGhost(p[0],p[1]);
});
svg.on('mouseleave',function(){tooltip.style.display='none';});

var rsT;
window.addEventListener('resize',function(){
  clearTimeout(rsT);
  rsT=setTimeout(function(){
    setup();
    computeRecs();
    renderDots(false,true);
    buildPanel();
    refreshSel();
  },150);
});

setup();
computeRecs();
renderDots(true,true);
buildPanel();
updateHeader();
buildLegend();
svg.style('cursor','grab');
})();
