// Preserve table semantics and contain wide dynamic admin/CSV tables.
function containTables(){for(const table of document.querySelectorAll('table')){if(table.closest('.table-scroll'))continue;const scroll=document.createElement('div');scroll.className='table-scroll';scroll.setAttribute('role','region');scroll.setAttribute('aria-label','Scrollable table');scroll.tabIndex=0;table.before(scroll);scroll.append(table);}}
containTables();new MutationObserver(containTables).observe(document.body,{childList:true,subtree:true});
