const sections=[['overview','Overview'],['departments','Departments'],['create-department','+ Create Department'],['accounts','Accounts'],['academic-setup','Academic Setup'],['workflow-setup','Workflow Setup'],['institution-settings','Institution Settings']];
const aliases={superOverview:'overview',departmentMaster:'departments',collegeAccounts:'accounts',academicSetup:'academic-setup',departmentWorkflow:'workflow-setup',institutionSettings:'institution-settings'};
export function workspaceSection(hash){const key=String(hash||'').replace(/^#/,'');return sections.some(([id])=>id===key)?key:aliases[key]||'overview';}
export function mountSuperWorkspace(content){
 const root=document.getElementById('superManagement'),panels=new Map(sections.map(([id,title])=>{const section=document.createElement('section');section.id='super-panel-'+id;section.dataset.superSection=id;section.setAttribute('aria-label',title);section.hidden=true;return[id,section];}));
 const move=(id,selector)=>{const node=document.querySelector(selector);if(node)panels.get(id).append(node);};
 move('create-department','#departmentCreate');move('overview','#superOverview');move('departments','#departmentMaster');move('departments','#leadershipHost');move('academic-setup','#academicSetup');move('workflow-setup','#departmentWorkflow');move('institution-settings','#institutionSettings');
 // Retain all existing account/import/search cards and their event handlers.
 for(const node of Array.from(content.children))if(node!==root){if(node.matches('.banner,nav'))panels.get('overview').append(node);else panels.get('accounts').append(node);}
 move('accounts','#accountDirectoryHost');
 const nav=document.createElement('nav');nav.className='super-tabs';nav.setAttribute('aria-label','Super Admin sections');for(const[id,title]of sections){const link=document.createElement('a');link.href='#'+id;link.textContent=title;nav.append(link);}
 root.replaceChildren(nav,...panels.values());content.replaceChildren(root);
 const show=()=>{const selected=workspaceSection(location.hash);for(const[id,panel]of panels)panel.hidden=id!==selected;for(const link of nav.children){if(link.hash==='#'+selected)link.setAttribute('aria-current','page');else link.removeAttribute('aria-current');}content.dataset.activeSection=selected;if(selected==='create-department')document.getElementById('departmentForm')?.reset();};
 show();window.addEventListener('hashchange',()=>{show();content.closest('.department-scroll').scrollTop=0;});
 document.body.classList.add('workspace-ready');content.setAttribute('aria-busy','false');
}
