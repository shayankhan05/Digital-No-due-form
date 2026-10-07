import {post} from './api.js';
const routes={institutionalAdmin:'/api/admin',studentWorkflow:'/api/students/workflow',officeStudentSearch:'/api/office/search'};
export const httpsCallable=(_,name)=>async input=>{if(!routes[name])throw new Error('Unknown operation.');try{return {data:await post(routes[name],input||{})};}catch(error){error.code='functions/'+error.code;throw error;}};
