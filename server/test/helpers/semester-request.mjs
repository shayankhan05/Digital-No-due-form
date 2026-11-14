import supertest from 'supertest';
// Existing regression clients explicitly select Semester 5; tests for missing or
// forged context use raw supertest in semester-context.test.mjs.
export default function request(app){
 const agent=supertest(app);
 for(const method of ['get','post','put','patch','delete']){
  const original=agent[method].bind(agent);
  agent[method]=(...args)=>original(...args).set('X-Semester','5');
 }
 return agent;
}
