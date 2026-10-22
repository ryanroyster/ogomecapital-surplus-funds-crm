'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');

test('partner demo is clearly isolated and uses fictional data only',()=>{
 const html=fs.readFileSync('public/demo.html','utf8');
 const js=fs.readFileSync('public/demo.js','utf8');
 assert.match(html,/Fictional data/);
 assert.match(js,/example\.test/);
 assert.match(js,/sessionStorage/);
 assert.doesNotMatch(js,/cloudRequest|\/api\/|access_token|service_role/);
 assert.match(js,/No message, document, call, or pipeline change can reach a real claimant/);
});

test('demo contains the approved seven pipeline sections and case profile',()=>{
 const js=fs.readFileSync('public/demo.js','utf8');
 for(const stage of ['New','Contacted','Docs Sent','Signed','Attorney Review','Claim Filed','Paid'])assert.match(js,new RegExp("'"+stage.replace(' ','\\s')+"'"));
 assert.match(js,/casegrid/);
 assert.match(js,/Excess Proceeds/);
 assert.match(js,/Activity & Notes/);
});
