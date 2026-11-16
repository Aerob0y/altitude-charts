(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.Budget=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  function walk(node,visit,parent=null){visit(node,parent);(node.children||[]).forEach(child=>walk(child,visit,node));}
  function validate(data){
    if(!Array.isArray(data.years)||data.years.length!==data.statuses.length)throw Error('Invalid year metadata');
    const ids=new Set();
    walk(data.root,node=>{
      if(ids.has(node.id))throw Error('Duplicate category');ids.add(node.id);
      if(!Array.isArray(node.values)||node.values.length!==data.years.length||node.values.some(v=>!Number.isFinite(v)))throw Error('Missing spending figures');
      if(node.children.length)node.values.forEach((v,i)=>{if(Math.abs(node.children.reduce((sum,c)=>sum+c.values[i],0)-v)>.01)throw Error('Category totals do not reconcile: '+node.name);});
    });
    if(data.root.values.some(v=>v<=0))throw Error('Invalid total');
    return data;
  }
  function compare(node,from,to,total){
    const before=node.values[from],after=node.values[to],change=after-before;
    return {id:node.id,name:node.name,before,after,change,percent:before===0?null:100*change/before,share:100*after/total.values[to],shareBefore:100*before/total.values[from]};
  }
  function rows(node,from,to,total){return (node.children.length?node.children:[node]).map(n=>compare(n,from,to,total)).sort((a,b)=>b.after-a.after||a.name.localeCompare(b.name));}
  function csv(data,node,from,to){
    const quote=v=>'"'+String(v==null?'':v).replaceAll('"','""')+'"';
    const header=['Category','From year ended June','From status','To year ended June','To status','From NZD millions','To NZD millions','Change NZD millions','Change percent','Share of all expenses percent','Source release'];
    const values=rows(node,from,to,data.root).map(r=>[r.name,data.years[from],data.statuses[from],data.years[to],data.statuses[to],r.before,r.after,r.change,r.percent,r.share,data.source.release]);
    return [header,...values].map(row=>row.map(quote).join(',')).join('\r\n')+'\r\n';
  }
  function validateHistory(history){
    if(!Array.isArray(history.years)||history.years[0]!==1972||history.years.at(-1)!==2026)throw Error('Invalid historical years');
    if(!Array.isArray(history.framework)||history.framework.length!==history.years.length)throw Error('Invalid historical framework');
    const ids=new Set();
    history.series.forEach(series=>{
      if(ids.has(series.id))throw Error('Duplicate historical series');ids.add(series.id);
      if(!Array.isArray(series.values)||series.values.length!==history.years.length)throw Error('Invalid historical series: '+series.name);
    });
    return history;
  }
  function slug(value){return String(value).toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');}
  function fullCsv(data,history){
    const quote=value=>'"'+String(value==null?'':value).replaceAll('"','""')+'"';
    const header=['Dataset','Series ID','Parent ID','Level','Category','Year ended','Status','NZD millions','Accounting basis','Year end','Source release','Source sheet','Source row','Source column','Comparability note'];
    const records=[];
    history.series.forEach(series=>series.values.forEach((value,i)=>{
      if(value==null||!Number.isFinite(value))return;
      const framework=history.framework[i];
      records.push(['Historical fiscal series',series.id,series.parent_id||'',series.parent_id?1:0,series.name,history.years[i],'Actual',value,framework.accounting_basis,framework.year_end,history.source.release,series.source_sheet,i+5,series.source_column||'',history.comparability.summary]);
    }));
    function addNode(node,parentId='',level=0,path=[]){
      const id=[...path,slug(node.name)].join('/');
      node.values.forEach((value,i)=>records.push(['PREFU 2026 detail',id,parentId,level,node.name,data.years[i],data.statuses[i],value,'PBE Standards','June',data.source.release,data.source.sheet,node.source_row,'','Recent hierarchy and forecasts; classifications can change between releases.']));
      (node.children||[]).forEach(child=>addNode(child,id,level+1,[...path,slug(node.name)]));
    }
    addNode(data.root);
    return [header,...records].map(row=>row.map(quote).join(',')).join('\r\n')+'\r\n';
  }
  return {walk,validate,compare,rows,csv,validateHistory,fullCsv};
});
