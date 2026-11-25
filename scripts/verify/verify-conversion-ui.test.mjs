import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'vite';
import {chromium} from 'playwright';

test('legacy conversion URL returns to the project workspace',async()=>{
 const server=await createServer({server:{port:0,host:'127.0.0.1'}});await server.listen();const browser=await chromium.launch({channel:'chrome',headless:true}),page=await browser.newPage();
 try{await page.goto(`${server.resolvedUrls.local[0]}conversion.html`);await page.waitForURL(server.resolvedUrls.local[0]);assert.equal(await page.locator('#conversion-form').count(),0);assert.equal(await page.locator('h1').innerText(),'Music Room');}finally{await browser.close();await server.close();}
});
