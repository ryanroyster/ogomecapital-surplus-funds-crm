const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../server.js'),'utf8');
const ctx=vm.createContext({});
vm.runInContext(source.slice(source.indexOf('function pickAuctionInfo'),source.indexOf('const server=http')),ctx);
const normalize=x=>ctx.normalize(x);

test('PropertyDetail maps nested situs and lot fields, not mailing address',()=>{
  const input={id:123,propertyInfo:{address:{address:'10 Test Rd',street:'Test',city:'Example',county:'Example County',state:'CA',zip:'90000'}},lotInfo:{apn:'001-002'},ownerInfo:{owner1FullName:'Test Owner',mailAddress:{address:'Wrong Address'}},auctionInfo:{auctionDate:'2026-11-05T00:00:00Z',active:false},estimatedValue:100000};
  const before=JSON.stringify(input),n=normalize(input);
  assert.equal(n.address,'10 Test Rd, Example, CA, 90000');
  assert.equal(n.county,'Example County');assert.equal(n.state,'CA');assert.equal(n.apn,'001-002');
  assert.equal(n.ownerName,'Test Owner');assert.equal(n.active,false);assert.equal(n.auctionDate,'2026-11-05');
  assert.equal(JSON.stringify(input),before);
});
test('flat search records still map, without repeating street fragments',()=>{
  const n=normalize({address:{address:'20 Test St',street:'Test',city:'Example',state:'FL',zip:'33000'},apn:'002',auctionInfo:{auctionDate:'2026-11-01'}});
  assert.equal(n.address,'20 Test St, Example, FL, 33000');assert.equal(n.apn,'002');assert.equal(n.state,'FL');
});
test('formatted labels and unformatted APNs are supported',()=>{
  const n=normalize({propertyInfo:{address:{label:'30 Test Lane, Example, NV 89000',state:'NV'}},lotInfo:{apnUnformatted:'000123'}});
  assert.equal(n.address,'30 Test Lane, Example, NV 89000');assert.equal(n.apn,'000123');
});
test('missing location stays missing and string addresses remain intact',()=>{
  const n=normalize({ownerInfo:{mailAddress:{address:'Not the property'}}});assert.equal(n.address,'');assert.equal(n.apn,null);
  assert.equal(normalize({address:'40 Example St',state:'OH'}).address,'40 Example St');
});
